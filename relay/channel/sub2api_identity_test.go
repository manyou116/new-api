package channel

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSub2APIIdentityUsesAuthenticatedUser(t *testing.T) {
	service.InitHttpClient()
	for _, tc := range []struct {
		name    string
		channel int
		config  map[string]any
		want    bool
	}{
		{"enabled", 59, map[string]any{"X-Sub2api-Source": "factory"}, true},
		{"disabled", 59, nil, false},
		{"other provider", 1, map[string]any{"X-Sub2api-Source": "factory"}, false},
		{"client placeholder rejected", 59, map[string]any{"X-Sub2api-Source": "{client_header:X-Spoof}"}, false},
		{"invalid source rejected", 59, map[string]any{"X-Sub2api-Source": "invalid source"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			received := make(chan http.Header, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				received <- r.Header.Clone()
				w.WriteHeader(http.StatusOK)
			}))
			defer upstream.Close()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader("{}"))
			c.Request.Header.Set("X-Sub2api-User", "forged-user")
			c.Request.Header.Set("X-Sub2api-Source", "forged-site")
			c.Request.Header.Set("X-Spoof", "forged-site")
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyUserName, "用户甲")
			info := &relaycommon.RelayInfo{UserId: 123, TokenId: 456, RequestId: "newapi-request-1", ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tc.channel, HeadersOverride: tc.config}}
			// Passthrough must not elevate caller-controlled identity headers.
			if info.HeadersOverride == nil {
				info.HeadersOverride = map[string]any{}
			}
			info.HeadersOverride["re:^X-Sub2api-.*$"] = true
			resp, err := DoApiRequest(&gzipTestAdaptor{url: upstream.URL}, c, info, strings.NewReader("{}"))
			require.NoError(t, err)
			require.NoError(t, resp.Body.Close())
			headers := <-received
			if !tc.want {
				assert.Empty(t, headers.Get("X-Sub2api-Source"))
				assert.Empty(t, headers.Get("X-Sub2api-User"))
				return
			}
			assert.Equal(t, "factory", headers.Get("X-Sub2api-Source"))
			data, err := base64.RawURLEncoding.DecodeString(headers.Get("X-Sub2api-User"))
			require.NoError(t, err)
			var user map[string]string
			require.NoError(t, common.Unmarshal(data, &user))
			assert.Equal(t, map[string]string{"user_id": "123", "username": "用户甲", "token_id": "456", "request_id": "newapi-request-1"}, user)
		})
	}
}

func TestSub2APIIdentityMissingRelayMetadata(t *testing.T) {
	for _, info := range []*relaycommon.RelayInfo{nil, {}} {
		header := http.Header{"X-Sub2api-User": []string{"forged"}}
		applySub2APIIdentity(header, nil, info)
		assert.Empty(t, header.Get("X-Sub2api-User"))
	}
}
