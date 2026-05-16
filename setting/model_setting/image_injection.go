package model_setting

import (
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/setting/config"
)

// ModelImageInjectionConfig 模型级别的 image_generation 工具注入覆盖配置。
// Enabled 为 *bool 三态语义：
//   - nil   表示沿用渠道级 / 全局级策略
//   - true  表示强制注入（不再受渠道/全局开关限制，但仍受 UnsupportedModels 黑名单限制）
//   - false 表示强制不注入
type ModelImageInjectionConfig struct {
	Enabled      *bool  `json:"enabled,omitempty"`
	ImageModel   string `json:"image_model,omitempty"`
	Size         string `json:"size,omitempty"`
	Quality      string `json:"quality,omitempty"`
	Background   string `json:"background,omitempty"`
	OutputFormat string `json:"output_format,omitempty"`
}

// ImageInjectionSettings 按模型名 -> ModelImageInjectionConfig 的映射。
type ImageInjectionSettings struct {
	mu     sync.RWMutex                         `json:"-"`
	Models map[string]ModelImageInjectionConfig `json:"models"`
}

var defaultImageInjectionSettings = ImageInjectionSettings{
	Models: map[string]ModelImageInjectionConfig{},
}

var imageInjectionSettings = defaultImageInjectionSettings

func init() {
	config.GlobalConfig.Register("image_generation_injection", &imageInjectionSettings)
}

// GetImageInjectionSettings 返回当前全局配置实例（指针）。
func GetImageInjectionSettings() *ImageInjectionSettings {
	return &imageInjectionSettings
}

// Get 按模型名查询模型级配置；找不到则返回 (零值, false)。
func (s *ImageInjectionSettings) Get(modelName string) (ModelImageInjectionConfig, bool) {
	if s == nil {
		return ModelImageInjectionConfig{}, false
	}
	target := strings.TrimSpace(modelName)
	if target == "" {
		return ModelImageInjectionConfig{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.Models == nil {
		return ModelImageInjectionConfig{}, false
	}
	cfg, ok := s.Models[target]
	return cfg, ok
}

// Set 写入/更新单个模型的配置（用于管理后台保存）。
func (s *ImageInjectionSettings) Set(modelName string, cfg ModelImageInjectionConfig) {
	if s == nil {
		return
	}
	target := strings.TrimSpace(modelName)
	if target == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Models == nil {
		s.Models = map[string]ModelImageInjectionConfig{}
	}
	s.Models[target] = cfg
}
