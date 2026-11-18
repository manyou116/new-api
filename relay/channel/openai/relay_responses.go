package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	info.ObserveResponseModel(responsesResponse.Model)
	responseBody = rewriteSGLangResponsesCreatedAt(info, responseBody, "created_at", responsesResponse.CreatedAt)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := &dto.Usage{}
	service.ApplyResponsesUsage(usage, responsesResponse.Usage)
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}
	info.ApplyVendorToolUsage(responseBody)

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	for i := range responsesResponse.Output {
		imageCounter.Observe(&responsesResponse.Output[i], &i)
	}
	imageCounter.Commit(info)

	return usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, common.LogText("invalid response or response body"))
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	accumulator := service.NewResponsesUsageAccumulator(info)
	waiveFailure := info.RelayMode == relayconstant.RelayModeResponses &&
		info.RelayFormat == types.RelayFormatOpenAIResponses &&
		!strings.HasPrefix(info.OriginModelName, "gpt-4o-audio") &&
		operation_setting.ShouldWaiveFailedResponses()
	if info.ResponsesUsageInfo != nil && info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration] != nil {
		waiveFailure = false
	}
	var deliveredTerminal bool

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, common.LogText("failed to unmarshal stream response: %s", err.Error()))
			sr.Error(err)
			return
		}
		if streamResponse.Response != nil {
			data = string(rewriteSGLangResponsesCreatedAt(info, []byte(data), "response.created_at", streamResponse.Response.CreatedAt))
		}
		writeErr := helper.ResponseChunkData(c, streamResponse, data)
		accumulator.Observe(&streamResponse, common.StringToByteSlice(data))
		if waiveFailure {
			if writeErr != nil {
				sr.Stop(writeErr)
				return
			}
			deliveredTerminal = deliveredTerminal || isBillableResponsesTerminal(&streamResponse)
		}
	})

	common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, info.StreamStatus)
	info.StreamStatus.RequireTerminal()
	usage := accumulator.Finish()
	if waiveFailure && (!deliveredTerminal || info.StreamStatus.ResponseFailed()) {
		info.WaiveFailedResponsesCharge = true
		// Preserve existing billing for completed, separately metered tool calls.
		if info.ResponsesUsageInfo != nil {
			for _, tool := range info.ResponsesUsageInfo.BuiltInTools {
				if tool != nil && tool.CallCount > 0 {
					info.WaiveFailedResponsesCharge = false
					break
				}
			}
		}
		if info.WaiveFailedResponsesCharge && info.StreamStatus.IsNormalEnd() &&
			!info.StreamStatus.ResponseFailed() && !info.StreamStatus.HasErrors() {
			info.StreamStatus.RecordError("Responses stream ended without a successfully delivered result")
		}
	}
	return usage, nil
}

func isBillableResponsesTerminal(event *dto.ResponsesStreamResponse) bool {
	response := event.Response
	if response == nil {
		return false
	}
	var status string
	if len(response.Status) > 0 && common.Unmarshal(response.Status, &status) != nil {
		return false
	}
	switch event.Type {
	case "response.completed", "response.done":
		if status == "" || status == "completed" {
			return response.Error == nil
		}
		if status != "incomplete" {
			return false
		}
	case "response.incomplete":
		if status != "" && status != "incomplete" {
			return false
		}
	default:
		return false
	}
	usage := response.Usage
	return response.Error == nil && response.IncompleteDetails != nil &&
		response.IncompleteDetails.Reason == "max_output_tokens" && usage != nil &&
		(usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.PromptTokens > 0 || usage.CompletionTokens > 0)
}

func rewriteSGLangResponsesCreatedAt(info *relaycommon.RelayInfo, payload []byte, path string, createdAt dto.IntValue) []byte {
	if info.GetChannelType() != constant.ChannelTypeSGLang {
		return payload
	}
	if !gjson.GetBytes(payload, path).Exists() {
		return payload
	}
	patched, err := sjson.SetBytes(payload, path, int(createdAt))
	if err != nil {
		return payload
	}
	return patched
}
