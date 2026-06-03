package oauth

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

func init() {
	Register("yaohuo", &YaohuoProvider{})
}

// YaohuoProvider implements OAuth for 妖火 (yaohuo.me)
// The token endpoint response directly includes user_info, so no separate user-info API call is needed.
type YaohuoProvider struct {
	// userInfoCache stores parsed user info keyed by access_token to bridge ExchangeToken → GetUserInfo
	userInfoCache sync.Map
}

type yaohuoTokenResponse struct {
	AccessToken string         `json:"access_token"`
	TokenType   string         `json:"token_type"`
	ExpiresIn   int            `json:"expires_in"`
	UserInfo    yaohuoUserInfo `json:"user_info"`
	Error       string         `json:"error"`
	ErrorDesc   string         `json:"error_description"`
}

type yaohuoUserInfo struct {
	UserId   int    `json:"userid"`
	Nickname string `json:"nickname"`
	Level    int    `json:"level"`
}

func (p *YaohuoProvider) GetName() string {
	return "妖火"
}

func (p *YaohuoProvider) IsEnabled() bool {
	return common.YaohuoOAuthEnabled
}

func (p *YaohuoProvider) ExchangeToken(ctx context.Context, code string, c *gin.Context) (*OAuthToken, error) {
	if code == "" {
		return nil, NewOAuthError(i18n.MsgOAuthInvalidCode, nil)
	}

	logger.LogDebug(ctx, "[OAuth-Yaohuo] ExchangeToken: code=%s...", code[:min(len(code), 10)])

	redirectURI := p.getRedirectURI(c)

	logger.LogDebug(ctx, "[OAuth-Yaohuo] ExchangeToken: redirect_uri=%s", redirectURI)

	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("client_id", common.YaohuoClientId)
	data.Set("client_secret", common.YaohuoClientSecret)
	data.Set("redirect_uri", redirectURI)

	req, err := http.NewRequestWithContext(ctx, "POST", "https://yaohuo.me/OAuth/Token.aspx", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Yaohuo] ExchangeToken error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "妖火"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Yaohuo] ExchangeToken response status: %d", res.StatusCode)

	var tokenRes yaohuoTokenResponse
	if err := common.DecodeJson(res.Body, &tokenRes); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Yaohuo] ExchangeToken decode error: %s", err.Error()))
		return nil, err
	}

	if tokenRes.AccessToken == "" {
		errMsg := tokenRes.ErrorDesc
		if errMsg == "" {
			errMsg = tokenRes.Error
		}
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Yaohuo] ExchangeToken failed: %s", errMsg))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "妖火"}, errMsg)
	}

	if tokenRes.UserInfo.UserId == 0 {
		logger.LogError(ctx, "[OAuth-Yaohuo] ExchangeToken: user_info missing in token response")
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "妖火"})
	}

	logger.LogDebug(ctx, "[OAuth-Yaohuo] ExchangeToken success: userid=%d, nickname=%s, level=%d",
		tokenRes.UserInfo.UserId, tokenRes.UserInfo.Nickname, tokenRes.UserInfo.Level)

	// Cache the user info for retrieval in GetUserInfo
	p.userInfoCache.Store(tokenRes.AccessToken, tokenRes.UserInfo)

	return &OAuthToken{
		AccessToken: tokenRes.AccessToken,
		TokenType:   tokenRes.TokenType,
		ExpiresIn:   tokenRes.ExpiresIn,
	}, nil
}

func (p *YaohuoProvider) getRedirectURI(c *gin.Context) string {
	if redirectURI, ok := sessions.Default(c).Get(RedirectURISessionKey("yaohuo")).(string); ok {
		redirectURI = strings.TrimSpace(redirectURI)
		if p.isValidRedirectURI(redirectURI) {
			return redirectURI
		}
	}

	scheme := "http"
	if c.Request != nil && c.Request.TLS != nil {
		scheme = "https"
	}
	if proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); proto != "" {
		scheme = strings.ToLower(strings.TrimSpace(strings.Split(proto, ",")[0]))
	}

	host := ""
	if c.Request != nil {
		host = c.Request.Host
	}
	if forwardedHost := strings.TrimSpace(c.GetHeader("X-Forwarded-Host")); forwardedHost != "" {
		host = strings.TrimSpace(strings.Split(forwardedHost, ",")[0])
	}

	return fmt.Sprintf("%s://%s/oauth/yaohuo", scheme, host)
}

func (p *YaohuoProvider) isValidRedirectURI(rawRedirectURI string) bool {
	parsed, err := url.Parse(rawRedirectURI)
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.Path == "/oauth/yaohuo" && parsed.RawQuery == "" && parsed.Fragment == ""
}

func (p *YaohuoProvider) GetUserInfo(ctx context.Context, token *OAuthToken) (*OAuthUser, error) {
	// Retrieve pre-cached user info from ExchangeToken
	val, ok := p.userInfoCache.LoadAndDelete(token.AccessToken)
	if !ok {
		logger.LogError(ctx, "[OAuth-Yaohuo] GetUserInfo: user_info not found in cache (already consumed?)")
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "妖火"})
	}

	userInfo, ok := val.(yaohuoUserInfo)
	if !ok || userInfo.UserId == 0 {
		logger.LogError(ctx, "[OAuth-Yaohuo] GetUserInfo: invalid cached user info")
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "妖火"})
	}

	logger.LogDebug(ctx, "[OAuth-Yaohuo] GetUserInfo success: userid=%d, nickname=%s, level=%d",
		userInfo.UserId, userInfo.Nickname, userInfo.Level)

	return &OAuthUser{
		ProviderUserID: strconv.Itoa(userInfo.UserId),
		Username:       fmt.Sprintf("yaohuo_%d", userInfo.UserId),
		DisplayName:    userInfo.Nickname,
		Extra: map[string]any{
			"level": userInfo.Level,
		},
	}, nil
}

func (p *YaohuoProvider) IsUserIDTaken(providerUserID string) bool {
	return model.IsYaohuoIdAlreadyTaken(providerUserID)
}

func (p *YaohuoProvider) FillUserByProviderID(user *model.User, providerUserID string) error {
	user.YaohuoId = providerUserID
	return user.FillUserByYaohuoId()
}

func (p *YaohuoProvider) SetProviderUserID(user *model.User, providerUserID string) {
	user.YaohuoId = providerUserID
}

func (p *YaohuoProvider) GetProviderPrefix() string {
	return "yaohuo_"
}

// BonusOnRegister gives the configured bonus quota when a new user registers via Yaohuo OAuth.
func (p *YaohuoProvider) BonusOnRegister(userId int) {
	if common.QuotaForYaohuoRegister <= 0 {
		return
	}
	if err := model.IncreaseUserQuota(userId, common.QuotaForYaohuoRegister, true); err != nil {
		common.SysError(fmt.Sprintf("[OAuth-Yaohuo] BonusOnRegister: failed to grant quota to user %d: %s", userId, err.Error()))
		return
	}
	model.RecordLog(userId, model.LogTypeSystem,
		fmt.Sprintf("妖火 OAuth 注册额外赠送 %s", logger.LogQuota(common.QuotaForYaohuoRegister)))
}

// BonusOnBind gives the configured bonus quota when a user binds their Yaohuo account.
func (p *YaohuoProvider) BonusOnBind(userId int) {
	if common.QuotaForYaohuoBind <= 0 {
		return
	}
	if err := model.IncreaseUserQuota(userId, common.QuotaForYaohuoBind, true); err != nil {
		common.SysError(fmt.Sprintf("[OAuth-Yaohuo] BonusOnBind: failed to grant quota to user %d: %s", userId, err.Error()))
		return
	}
	model.RecordLog(userId, model.LogTypeSystem,
		fmt.Sprintf("绑定妖火账号赠送 %s", logger.LogQuota(common.QuotaForYaohuoBind)))
}
