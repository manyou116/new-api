package common

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func boolPtr(b bool) *bool { return &b }

func newTestInfo(channelOverride *bool) *RelayInfo {
	return &RelayInfo{
		ChannelMeta: &ChannelMeta{
			ChannelId:   1,
			ChannelType: 1,
			ChannelOtherSettings: dto.ChannelOtherSettings{
				ImageGenerationInjection: channelOverride,
			},
		},
	}
}

func setGlobalPolicy(t *testing.T, p model_setting.ImageGenerationInjectionPolicy) {
	t.Helper()
	g := model_setting.GetGlobalSettings()
	prev := g.ImageGenerationInjectionPolicy
	g.ImageGenerationInjectionPolicy = p
	t.Cleanup(func() { g.ImageGenerationInjectionPolicy = prev })
}

func TestShouldInjectImageGeneration_UnsupportedShortCircuits(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{
		Enabled: true, AllChannels: true,
		ModelPatterns:     []string{"gpt-5.5*"},
		UnsupportedModels: []string{"gpt-5.5-no-images"},
	})
	info := newTestInfo(boolPtr(true)) // even channel override true
	if ShouldInjectImageGenerationTool(info, "gpt-5.5-no-images") {
		t.Fatal("unsupported model should not be injected even with channel override")
	}
}

func TestShouldInjectImageGeneration_ImageOnlyModel(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{Enabled: true, AllChannels: true, ModelPatterns: []string{"*"}})
	info := newTestInfo(boolPtr(true))
	if ShouldInjectImageGenerationTool(info, "gpt-image-1") {
		t.Fatal("image-only model must not be injected")
	}
}

func TestShouldInjectImageGeneration_ChannelOverrideWins(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{Enabled: true, AllChannels: true, ModelPatterns: []string{"gpt-5.5*"}})
	info := newTestInfo(boolPtr(false))
	if ShouldInjectImageGenerationTool(info, "gpt-5.5") {
		t.Fatal("channel override false must beat global enabled")
	}
}

func TestShouldInjectImageGeneration_ModelOverridesChannelAndGlobal(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{Enabled: false, AllChannels: false})
	info := newTestInfo(boolPtr(false))
	model_setting.GetImageInjectionSettings().Set("gpt-5.5-custom", model_setting.ModelImageInjectionConfig{Enabled: boolPtr(true)})
	t.Cleanup(func() {
		model_setting.GetImageInjectionSettings().Set("gpt-5.5-custom", model_setting.ModelImageInjectionConfig{})
	})
	if !ShouldInjectImageGenerationTool(info, "gpt-5.5-custom") {
		t.Fatal("model-level Enabled=true must override channel false + global disabled")
	}

	model_setting.GetImageInjectionSettings().Set("gpt-5.5-off", model_setting.ModelImageInjectionConfig{Enabled: boolPtr(false)})
	t.Cleanup(func() {
		model_setting.GetImageInjectionSettings().Set("gpt-5.5-off", model_setting.ModelImageInjectionConfig{})
	})
	infoChannelOn := newTestInfo(boolPtr(true))
	if ShouldInjectImageGenerationTool(infoChannelOn, "gpt-5.5-off") {
		t.Fatal("model-level Enabled=false must override channel true")
	}
}

func TestShouldInjectImageGeneration_GlobalPatternMatch(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{Enabled: true, AllChannels: true, ModelPatterns: []string{"gpt-5.5*"}})
	info := newTestInfo(nil)
	if !ShouldInjectImageGenerationTool(info, "gpt-5.5-thinking") {
		t.Fatal("global pattern should match gpt-5.5-thinking")
	}
	if ShouldInjectImageGenerationTool(info, "gpt-4o") {
		t.Fatal("gpt-4o should not match gpt-5.5* pattern")
	}
}

func TestInjectImageGenerationTool_AddsToolAndInstructions(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{DefaultOutputFormat: "png"})
	body := []byte(`{"model":"gpt-5.5","instructions":"hi"}`)
	out, modified, err := InjectImageGenerationTool(nil, newTestInfo(nil), body, "gpt-5.5")
	if err != nil {
		t.Fatal(err)
	}
	if !modified {
		t.Fatal("expected modification")
	}
	s := string(out)
	if !strings.Contains(s, `"image_generation"`) {
		t.Fatalf("tool not injected: %s", s)
	}
	if !strings.Contains(s, "image-generation-bridge") {
		t.Fatalf("marker not injected: %s", s)
	}
	if !strings.Contains(s, "hi") {
		t.Fatalf("existing instructions lost: %s", s)
	}
}

func TestInjectImageGenerationTool_IsIdempotent(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{DefaultOutputFormat: "png"})
	body := []byte(`{"model":"gpt-5.5"}`)
	first, _, err := InjectImageGenerationTool(nil, newTestInfo(nil), body, "gpt-5.5")
	if err != nil {
		t.Fatal(err)
	}
	_, modified, err := InjectImageGenerationTool(nil, newTestInfo(nil), first, "gpt-5.5")
	if err != nil {
		t.Fatal(err)
	}
	if modified {
		t.Fatal("second injection should be a no-op (idempotent)")
	}
}

func TestInjectImageGenerationTool_StripsCompression(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{DefaultOutputFormat: "png"})
	body := []byte(`{"model":"gpt-5.5","tools":[{"type":"image_generation","compression":80}]}`)
	out, modified, err := InjectImageGenerationTool(nil, newTestInfo(nil), body, "gpt-5.5")
	if err != nil {
		t.Fatal(err)
	}
	if !modified {
		t.Fatal("expected modification (compression stripped + instructions injected)")
	}
	if strings.Contains(string(out), "compression") {
		t.Fatalf("compression field must be stripped: %s", out)
	}
}

func TestInjectImageGenerationTool_PreservesExistingTools(t *testing.T) {
	setGlobalPolicy(t, model_setting.ImageGenerationInjectionPolicy{DefaultOutputFormat: "png"})
	body := []byte(`{"model":"gpt-5.5","tools":[{"type":"web_search"}]}`)
	out, _, err := InjectImageGenerationTool(nil, newTestInfo(nil), body, "gpt-5.5")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if !strings.Contains(s, "web_search") {
		t.Fatalf("existing tool dropped: %s", s)
	}
	if !strings.Contains(s, "image_generation") {
		t.Fatalf("image_generation not appended: %s", s)
	}
}
