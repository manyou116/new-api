package channel

import (
	"encoding/base64"
	"net/http"
	"regexp"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

var sub2apiSourcePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// applySub2APIIdentity uses the saved channel configuration and authenticated
// relay identity, never identity headers supplied by an API client.
func applySub2APIIdentity(header http.Header, c *gin.Context, info *relaycommon.RelayInfo) {
	header.Del("X-Sub2api-Source")
	header.Del("X-Sub2api-User")
	if info == nil || info.ChannelMeta == nil || info.ChannelType != 59 || info.UserId <= 0 {
		return
	}
	source := ""
	for key, value := range relaycommon.GetEffectiveHeaderOverride(info) {
		if http.CanonicalHeaderKey(key) == "X-Sub2api-Source" {
			source, _ = value.(string)
		}
	}
	if !sub2apiSourcePattern.MatchString(source) {
		return
	}
	identity := struct {
		UserID    string `json:"user_id"`
		Username  string `json:"username,omitempty"`
		TokenID   string `json:"token_id,omitempty"`
		RequestID string `json:"request_id,omitempty"`
	}{
		UserID:    strconv.Itoa(info.UserId),
		Username:  common.GetContextKeyString(c, constant.ContextKeyUserName),
		RequestID: info.RequestId,
	}
	if info.TokenId > 0 {
		identity.TokenID = strconv.Itoa(info.TokenId)
	}
	// Bound optional snapshots without affecting relay availability.
	if len(identity.Username) > 256 {
		identity.Username = ""
	}
	if len(identity.RequestID) > 128 {
		identity.RequestID = ""
	}
	data, err := common.Marshal(identity)
	if err != nil {
		return
	}
	header.Set("X-Sub2api-Source", source)
	header.Set("X-Sub2api-User", base64.RawURLEncoding.EncodeToString(data))
}
