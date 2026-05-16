package model_setting

import (
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

type ChatCompletionsToResponsesPolicy struct {
	Enabled       bool     `json:"enabled"`
	AllChannels   bool     `json:"all_channels"`
	ChannelIDs    []int    `json:"channel_ids,omitempty"`
	ChannelTypes  []int    `json:"channel_types,omitempty"`
	ModelPatterns []string `json:"model_patterns,omitempty"`
}

func (p ChatCompletionsToResponsesPolicy) IsChannelEnabled(channelID int, channelType int) bool {
	if !p.Enabled {
		return false
	}
	if p.AllChannels {
		return true
	}

	if channelID > 0 && len(p.ChannelIDs) > 0 && slices.Contains(p.ChannelIDs, channelID) {
		return true
	}
	if channelType > 0 && len(p.ChannelTypes) > 0 && slices.Contains(p.ChannelTypes, channelType) {
		return true
	}
	return false
}

// ImageGenerationInjectionPolicy 控制是否给文本模型注入 Responses 原生 image_generation 工具，
// 让纯文本模型 (如 gpt-5.5) 也能在一次请求中触发生图，从而实现"文本模型优雅出图"的闭环。
type ImageGenerationInjectionPolicy struct {
	Enabled             bool     `json:"enabled"`
	AllChannels         bool     `json:"all_channels"`
	ChannelIDs          []int    `json:"channel_ids,omitempty"`
	ChannelTypes        []int    `json:"channel_types,omitempty"`
	ModelPatterns       []string `json:"model_patterns,omitempty"`     // 通配符 / 前缀匹配，例: gpt-5.5*
	UnsupportedModels   []string `json:"unsupported_models,omitempty"` // 黑名单，命中则永不注入
	DefaultOutputFormat string   `json:"default_output_format,omitempty"`
	DefaultSize         string   `json:"default_size,omitempty"`
	DefaultQuality      string   `json:"default_quality,omitempty"`
	DefaultBackground   string   `json:"default_background,omitempty"`
	DefaultImageModel   string   `json:"default_image_model,omitempty"`
}

// IsChannelEnabled 判断当前渠道是否落在策略生效范围内。
// 注意：此函数只回答"渠道范围"，不回答"模型范围"；模型匹配由 IsModelMatched 负责。
func (p ImageGenerationInjectionPolicy) IsChannelEnabled(channelID int, channelType int) bool {
	if !p.Enabled {
		return false
	}
	if p.AllChannels {
		return true
	}
	if channelID > 0 && len(p.ChannelIDs) > 0 && slices.Contains(p.ChannelIDs, channelID) {
		return true
	}
	if channelType > 0 && len(p.ChannelTypes) > 0 && slices.Contains(p.ChannelTypes, channelType) {
		return true
	}
	return false
}

// IsModelUnsupported 判断模型是否在黑名单中（命中则强制跳过注入）。
func (p ImageGenerationInjectionPolicy) IsModelUnsupported(modelName string) bool {
	target := strings.TrimSpace(modelName)
	if target == "" {
		return true
	}
	for _, entry := range p.UnsupportedModels {
		if matchModelPattern(entry, target) {
			return true
		}
	}
	return false
}

// IsModelMatched 判断模型是否落在 ModelPatterns 白名单内。
// 未配置 patterns 时视为"全模型匹配"。
func (p ImageGenerationInjectionPolicy) IsModelMatched(modelName string) bool {
	target := strings.TrimSpace(modelName)
	if target == "" {
		return false
	}
	if len(p.ModelPatterns) == 0 {
		return true
	}
	for _, entry := range p.ModelPatterns {
		if matchModelPattern(entry, target) {
			return true
		}
	}
	return false
}

// matchModelPattern 支持精确匹配以及尾部通配符 (例 "gpt-5*" 匹配 "gpt-5", "gpt-5.5")。
func matchModelPattern(pattern string, target string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return false
	}
	if strings.HasSuffix(pattern, "*") {
		prefix := strings.TrimSuffix(pattern, "*")
		return strings.HasPrefix(target, prefix)
	}
	return pattern == target
}

type GlobalSettings struct {
	PassThroughRequestEnabled        bool                             `json:"pass_through_request_enabled"`
	ThinkingModelBlacklist           []string                         `json:"thinking_model_blacklist"`
	ChatCompletionsToResponsesPolicy ChatCompletionsToResponsesPolicy `json:"chat_completions_to_responses_policy"`
	ImageGenerationInjectionPolicy   ImageGenerationInjectionPolicy   `json:"image_generation_injection_policy"`
}

// 默认配置
var defaultOpenaiSettings = GlobalSettings{
	PassThroughRequestEnabled: false,
	ThinkingModelBlacklist: []string{
		"moonshotai/kimi-k2-thinking",
		"kimi-k2-thinking",
	},
	ChatCompletionsToResponsesPolicy: ChatCompletionsToResponsesPolicy{
		Enabled:     false,
		AllChannels: true,
	},
	ImageGenerationInjectionPolicy: ImageGenerationInjectionPolicy{
		Enabled:             false,
		AllChannels:         true,
		ModelPatterns:       []string{"gpt-5.5*", "gpt-5.4*"},
		UnsupportedModels:   []string{"gpt-image-*", "gpt-5.3-codex-spark"},
		DefaultOutputFormat: "png",
	},
}

// 全局实例
var globalSettings = defaultOpenaiSettings

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("global", &globalSettings)
}

func GetGlobalSettings() *GlobalSettings {
	return &globalSettings
}

// ShouldPreserveThinkingSuffix 判断模型是否配置为保留 thinking/-nothinking/-low/-high/-medium 后缀
func ShouldPreserveThinkingSuffix(modelName string) bool {
	target := strings.TrimSpace(modelName)
	if target == "" {
		return false
	}

	for _, entry := range globalSettings.ThinkingModelBlacklist {
		if strings.TrimSpace(entry) == target {
			return true
		}
	}
	return false
}
