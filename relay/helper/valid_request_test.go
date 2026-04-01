package helper

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGetAndValidateTextRequestAcceptsResponsesCompatPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `{
		"model":"gpt-4.1",
		"instructions":"You are helpful",
		"input":"hello from cursor",
		"max_output_tokens":32,
		"parallel_tool_calls":true,
		"tool_choice":{"type":"function","name":"run_cmd"},
		"tools":[
			{"type":"function","name":"run_cmd","description":"Run shell command","parameters":{"type":"object"}}
		]
	}`

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	request, err := GetAndValidateTextRequest(c, relayconstant.RelayModeChatCompletions)
	require.NoError(t, err)
	require.Equal(t, "gpt-4.1", request.Model)
	require.Len(t, request.Messages, 2)
	require.Equal(t, "system", request.Messages[0].Role)
	require.Equal(t, "You are helpful", request.Messages[0].Content)
	require.Equal(t, "user", request.Messages[1].Role)
	require.Equal(t, "hello from cursor", request.Messages[1].Content)
	require.NotNil(t, request.MaxTokens)
	require.Equal(t, uint(32), *request.MaxTokens)
	require.NotNil(t, request.ParallelTooCalls)
	require.True(t, *request.ParallelTooCalls)
	require.Len(t, request.Tools, 1)
	require.Equal(t, "run_cmd", request.Tools[0].Function.Name)

	toolChoice, ok := request.ToolChoice.(map[string]any)
	require.True(t, ok)
	require.Equal(t, "function", toolChoice["type"])
	function, ok := toolChoice["function"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "run_cmd", function["name"])
}

func TestGetAndValidateTextRequestReadsRawJSONWithoutContentType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body := `{"model":"gpt-4.1","input":"hello without content type"}`

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))

	request, err := GetAndValidateTextRequest(c, relayconstant.RelayModeChatCompletions)
	require.NoError(t, err)
	require.Equal(t, "gpt-4.1", request.Model)
	require.Len(t, request.Messages, 1)
	require.Equal(t, "user", request.Messages[0].Role)
	require.Equal(t, "hello without content type", request.Messages[0].Content)
}
