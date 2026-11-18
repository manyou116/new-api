package relay

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type responsesFailingWriter struct {
	*httptest.ResponseRecorder
	cancel       context.CancelFunc
	failTerminal bool
	cancelOn     string
}

func (w responsesFailingWriter) WriteString(s string) (int, error) {
	if w.failTerminal && strings.HasPrefix(s, "event: response.completed\n") {
		return 0, errors.New("downstream write failed")
	}
	return w.ResponseRecorder.WriteString(s)
}

func (w responsesFailingWriter) Flush() {
	w.ResponseRecorder.Flush()
	if w.cancelOn != "" && strings.Contains(w.Body.String(), w.cancelOn) {
		w.cancel()
	}
}

func TestResponsesSSEFailureBilling(t *testing.T) {
	const option = "quota_setting.waive_failed_responses"
	const initialQuota = 100_000
	const reserve = 20_000
	const fixedCharge = 5_000
	const created = "data: {\"type\":\"response.created\"}\n\n"
	const partial = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial output\"}\n\n"
	const completed = "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":100,\"output_tokens\":5}}}\n\n"
	cases := []struct {
		name, stream                         string
		disabled, brokenWriter, subscription bool
		cancelOn                             string
		charge                               int
	}{
		{name: "lifecycle events and DONE without response", stream: strings.Repeat(created, 3) + "data: [DONE]\n\n"},
		{name: "partial text then EOF", stream: created + partial},
		{name: "subscription reservation released", stream: created + partial, subscription: true},
		{name: "client cancels after partial text", stream: created + partial, cancelOn: "partial output"},
		{name: "429 terminal with reported usage", stream: partial + "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"code\":\"rate_limit_exceeded\"},\"usage\":{\"input_tokens\":100,\"output_tokens\":5}}}\n\n"},
		{name: "successful terminal not written", stream: created + completed, brokenWriter: true},
		{name: "terminal delivered before EOF", stream: created + completed, charge: fixedCharge},
		{name: "client cancels after terminal delivered", stream: created + completed, cancelOn: "event: response.completed", charge: fixedCharge},
		{name: "normal output limit", stream: "data: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"usage\":{\"input_tokens\":100,\"output_tokens\":5}}}\n\n", charge: fixedCharge},
		{name: "disabled retains estimated billing", stream: created + partial, disabled: true, charge: fixedCharge},
	}
	for _, dbCase := range []struct {
		name string
		kind common.DatabaseType
		db   func() gorm.Dialector
	}{
		{name: "sqlite", kind: common.DatabaseTypeSQLite, db: func() gorm.Dialector { return sqlite.Open(":memory:") }},
		{name: "mysql", kind: common.DatabaseTypeMySQL, db: func() gorm.Dialector {
			if dsn := os.Getenv("TEST_MYSQL_DSN"); dsn != "" {
				return mysql.Open(dsn)
			}
			return nil
		}},
		{name: "postgres", kind: common.DatabaseTypePostgreSQL, db: func() gorm.Dialector {
			if dsn := os.Getenv("TEST_POSTGRES_DSN"); dsn != "" {
				return postgres.Open(dsn)
			}
			return nil
		}},
	} {
		t.Run(dbCase.name, func(t *testing.T) {
			dialect := dbCase.db()
			if dialect == nil {
				t.Skip("database DSN not configured")
			}
			db, err := gorm.Open(dialect, &gorm.Config{})
			require.NoError(t, err)
			conn, err := db.DB()
			require.NoError(t, err)
			conn.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, conn.Close()) })
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}, &model.Channel{}, &model.Option{},
				&model.UserSubscription{}, &model.SubscriptionPlan{}, &model.SubscriptionPreConsumeRecord{}))
			versionQuery := "SELECT VERSION()"
			if dbCase.kind == common.DatabaseTypeSQLite {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("%s version: %s", dbCase.name, version)
			oldDB, oldLogs, oldKind := model.DB, model.LOG_DB, common.MainDatabaseType()
			oldRedis, oldBatch, oldConsume := common.RedisEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled
			oldTimeout := constant.StreamingTimeout
			oldOptions := common.OptionMap
			model.DB, model.LOG_DB = db, db
			common.SetMainDatabaseType(dbCase.kind)
			common.RedisEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = false, false, true
			constant.StreamingTimeout = 30
			common.OptionMap = map[string]string{}
			t.Cleanup(func() {
				require.NoError(t, model.UpdateOption(option, "true"))
				model.DB, model.LOG_DB = oldDB, oldLogs
				common.SetMainDatabaseType(oldKind)
				common.RedisEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = oldRedis, oldBatch, oldConsume
				constant.StreamingTimeout = oldTimeout
				common.OptionMap = oldOptions
			})
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					id := common.GetUUID()
					username := "sse-" + id[:16]
					user := model.User{Username: username, AffCode: id[:16], Quota: initialQuota}
					require.NoError(t, db.Create(&user).Error)
					token := model.Token{UserId: user.Id, Key: strings.Repeat("0", 16) + id, RemainQuota: initialQuota}
					require.NoError(t, db.Create(&token).Error)
					require.NoError(t, model.UpdateOption(option, strconv.FormatBool(!tc.disabled)))
					requestContext, cancel := context.WithCancel(t.Context())
					t.Cleanup(cancel)
					w := responsesFailingWriter{ResponseRecorder: httptest.NewRecorder(), failTerminal: tc.brokenWriter, cancelOn: tc.cancelOn, cancel: cancel}
					c, _ := gin.CreateTestContext(w)
					c.Request = httptest.NewRequestWithContext(requestContext, http.MethodPost, "/v1/responses", nil)
					c.Set(common.RequestIdKey, username)
					info := &relaycommon.RelayInfo{
						RelayMode: relayconstant.RelayModeResponses, RelayFormat: types.RelayFormatOpenAIResponses,
						OriginModelName: "gpt-5.1", StartTime: time.Now(), IsStream: true, DisablePing: true,
						UserSetting: dto.UserSetting{BillingPreference: "wallet_only"},
						UserId:      user.Id, TokenId: token.Id, TokenKey: token.Key, ForcePreConsume: true,
						ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.1"},
						PriceData:   hosttypes.PriceData{UsePrice: true, ModelPrice: 0.01, GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: 1}},
					}
					var sub model.UserSubscription
					if tc.subscription {
						plan := model.SubscriptionPlan{Title: "Responses test plan"}
						require.NoError(t, db.Create(&plan).Error)
						sub = model.UserSubscription{PlanId: plan.Id, UserId: user.Id, AmountTotal: initialQuota,
							EndTime: time.Now().Add(time.Hour).Unix(), Status: "active"}
						require.NoError(t, db.Create(&sub).Error)
						info.RequestId = username
						info.UserSetting.BillingPreference = "subscription_only"
					}
					info.SetEstimatePromptTokens(200_000)
					require.Nil(t, service.PreConsumeBilling(c, reserve, info))
					require.Equal(t, reserve, info.Billing.GetPreConsumedQuota())
					if tc.subscription {
						require.NoError(t, db.First(&sub, sub.Id).Error)
						require.EqualValues(t, reserve, sub.AmountUsed)
					}
					resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(tc.stream))}
					usage, apiErr := openai.OaiResponsesStreamHandler(c, info, resp)
					require.Nil(t, apiErr)
					ConsumeResponsesQuota(c, info, usage)
					require.NoError(t, db.First(&user, user.Id).Error)
					require.NoError(t, db.First(&token, token.Id).Error)
					assert.Equal(t, initialQuota-tc.charge, user.Quota)
					assert.Equal(t, initialQuota-tc.charge, token.RemainQuota)
					if tc.subscription {
						require.NoError(t, db.First(&sub, sub.Id).Error)
						assert.Zero(t, sub.AmountUsed)
					}
					var log model.Log
					require.NoError(t, db.Where("request_id = ?", username).First(&log).Error)
					assert.Equal(t, tc.charge, log.Quota)
					if tc.charge == 0 {
						assert.Zero(t, user.UsedQuota)
						assert.Zero(t, token.UsedQuota)
						assert.Contains(t, log.Other, `"billing_status":"waived"`)
					}
				})
			}
		})
	}
}
