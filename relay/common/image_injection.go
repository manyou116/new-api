package common

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/model_setting"

	"github.com/gin-gonic/gin"
)

// ImageGenerationBridgeMarker 用于在 instructions 中标记本次注入，
// 防止跨重试或链路中多次注入造成 prompt 污染。
const ImageGenerationBridgeMarker = "<new-api-image-generation-bridge>"

// imageGenerationBridgeInstructions 是注入给模型的引导文本。
// 关键点：明确告诉模型工具已 attached，不要因为"本地缺工具"而拒绝。
const imageGenerationBridgeInstructions = ImageGenerationBridgeMarker + `
When the user asks for raster image generation or editing, use the attached native ` + "`image_generation`" + ` tool to fulfill the request.
Do not refuse on the grounds that an image tool is unavailable — it is attached to this request and ready to use.
Treat the tool as the canonical way to produce images in this turn; do not ask the user to switch clients.
</new-api-image-generation-bridge>`

// imageOnlyModelHints 用于判断模型自身是否就是"纯图模型"。
// 命中时不能再给它挂 image_generation 工具（OpenAI 会拒绝）。
var imageOnlyModelHints = []string{"gpt-image", "dall-e", "image-alpha"}

// ShouldInjectImageGenerationTool 决定当前请求是否应当注入 image_generation 工具。
//
// 优先级（高 → 低）：
//  1. 模型在全局 UnsupportedModels 黑名单中 → 永不注入
//  2. 模型自身是纯图模型 → 永不注入
//  3. 模型级 Enabled 显式 bool → 直接返回
//  4. 渠道级 Enabled (*bool) 显式 → 直接返回
//  5. 全局策略：开关 + 渠道范围 + ModelPatterns 命中 → 返回 true
//  6. 其余情况 → false
func ShouldInjectImageGenerationTool(info *RelayInfo, modelName string) bool {
	if info == nil {
		return false
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return false
	}

	policy := model_setting.GetGlobalSettings().ImageGenerationInjectionPolicy

	if policy.IsModelUnsupported(modelName) {
		return false
	}
	if isImageOnlyModel(modelName) {
		return false
	}

	if modelCfg, ok := model_setting.GetImageInjectionSettings().Get(modelName); ok && modelCfg.Enabled != nil {
		return *modelCfg.Enabled
	}

	if info.ChannelOtherSettings.ImageGenerationInjection != nil {
		return *info.ChannelOtherSettings.ImageGenerationInjection
	}

	if !policy.IsChannelEnabled(info.ChannelId, info.ChannelType) {
		return false
	}
	return policy.IsModelMatched(modelName)
}

// isImageOnlyModel 粗略判断模型是否纯图模型。
func isImageOnlyModel(modelName string) bool {
	lower := strings.ToLower(modelName)
	for _, hint := range imageOnlyModelHints {
		if strings.Contains(lower, hint) {
			return true
		}
	}
	return false
}

// InjectImageGenerationTool 给 Responses 请求 JSON 注入 image_generation 工具与 instructions。
//
// 返回：
//   - 注入后的 JSON（即使无修改也会返回非 nil）
//   - modified: 是否真的发生了修改（用于日志/审计）
//   - err: 解析或重写失败
//
// 调用方应在 ShouldInjectImageGenerationTool 返回 true 时再调用本函数。
func InjectImageGenerationTool(c *gin.Context, info *RelayInfo, jsonData []byte, modelName string) ([]byte, bool, error) {
	if len(jsonData) == 0 {
		return jsonData, false, nil
	}

	var body map[string]any
	if err := common.Unmarshal(jsonData, &body); err != nil {
		return jsonData, false, err
	}
	if body == nil {
		return jsonData, false, nil
	}

	modelName = strings.TrimSpace(modelName)
	modelCfg, _ := model_setting.GetImageInjectionSettings().Get(modelName)
	policy := model_setting.GetGlobalSettings().ImageGenerationInjectionPolicy

	modifiedTool := ensureImageGenerationToolInBody(body, modelCfg, policy)
	normalized := normalizeImageGenerationTools(body)
	modifiedInstr := injectImageGenerationInstructions(body)

	modified := modifiedTool || normalized || modifiedInstr
	if !modified {
		return jsonData, false, nil
	}

	out, err := common.Marshal(body)
	if err != nil {
		return jsonData, false, err
	}

	if c != nil {
		logger.LogInfo(c, "[image_generation] injected tool for model="+modelName)
	}
	return out, true, nil
}

// ensureImageGenerationToolInBody 在 tools 数组里追加 image_generation 工具。
// 如已存在同类型工具则跳过；tools 字段缺失/非数组时会被替换为新数组。
func ensureImageGenerationToolInBody(
	body map[string]any,
	modelCfg model_setting.ModelImageInjectionConfig,
	policy model_setting.ImageGenerationInjectionPolicy,
) bool {
	tool := buildImageGenerationTool(modelCfg, policy)

	rawTools, exists := body["tools"]
	if !exists || rawTools == nil {
		body["tools"] = []any{tool}
		return true
	}

	tools, ok := rawTools.([]any)
	if !ok {
		body["tools"] = []any{tool}
		return true
	}

	for _, raw := range tools {
		toolMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(stringFromAny(toolMap["type"])) == "image_generation" {
			return false
		}
	}

	body["tools"] = append(tools, tool)
	return true
}

// buildImageGenerationTool 根据模型级与全局默认值拼装 tool 对象。
// 仅设置非空字段，避免向上游发送空字符串造成校验失败。
func buildImageGenerationTool(
	modelCfg model_setting.ModelImageInjectionConfig,
	policy model_setting.ImageGenerationInjectionPolicy,
) map[string]any {
	tool := map[string]any{"type": "image_generation"}

	put := func(key string, modelVal string, defaultVal string) {
		if v := strings.TrimSpace(modelVal); v != "" {
			tool[key] = v
			return
		}
		if v := strings.TrimSpace(defaultVal); v != "" {
			tool[key] = v
		}
	}

	put("output_format", modelCfg.OutputFormat, policy.DefaultOutputFormat)
	put("size", modelCfg.Size, policy.DefaultSize)
	put("quality", modelCfg.Quality, policy.DefaultQuality)
	put("background", modelCfg.Background, policy.DefaultBackground)
	put("model", modelCfg.ImageModel, policy.DefaultImageModel)

	if _, ok := tool["output_format"]; !ok {
		tool["output_format"] = "png"
	}
	return tool
}

// normalizeImageGenerationTools 移除 OpenAI 当前已知会拒绝的字段。
// 目前仅清理 compression（sub2api 实测有这个坑）。后续如发现新字段在此扩展。
func normalizeImageGenerationTools(body map[string]any) bool {
	rawTools, ok := body["tools"]
	if !ok || rawTools == nil {
		return false
	}
	tools, ok := rawTools.([]any)
	if !ok {
		return false
	}
	modified := false
	for _, raw := range tools {
		toolMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(stringFromAny(toolMap["type"])) != "image_generation" {
			continue
		}
		if _, has := toolMap["compression"]; has {
			delete(toolMap, "compression")
			modified = true
		}
	}
	return modified
}

// injectImageGenerationInstructions 把引导文本拼接到 instructions 字段。
// 使用 marker 判重，已注入过的请求不会重复追加。
func injectImageGenerationInstructions(body map[string]any) bool {
	existing := stringFromAny(body["instructions"])
	if strings.Contains(existing, ImageGenerationBridgeMarker) {
		return false
	}
	existing = strings.TrimRight(existing, " \t\r\n")
	if strings.TrimSpace(existing) == "" {
		body["instructions"] = imageGenerationBridgeInstructions
		return true
	}
	body["instructions"] = existing + "\n\n" + imageGenerationBridgeInstructions
	return true
}

func stringFromAny(v any) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
