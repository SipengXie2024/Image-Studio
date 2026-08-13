package backend

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func TestFlattenTransparentImageRewritesPNG(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "transparent.png")
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 0, B: 0, A: 0})
	img.SetNRGBA(1, 0, color.NRGBA{R: 0, G: 255, B: 0, A: 255})
	img.SetNRGBA(0, 1, color.NRGBA{R: 0, G: 0, B: 255, A: 255})
	img.SetNRGBA(1, 1, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	rewritten, tmp, err := flattenTransparentImage(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if rewritten == srcPath {
		t.Fatal("expected transparent PNG to be rewritten")
	}
	if tmp == "" {
		t.Fatal("expected temp file path")
	}
	defer os.Remove(tmp)

	got, err := os.ReadFile(rewritten)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(got, []byte("\x89PNG")) {
		t.Fatalf("rewritten file is not png: %q", got[:8])
	}
}

func TestFlattenOpaquePNGKeepsOriginalPath(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "opaque.png")
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	rewritten, tmp, err := flattenTransparentImage(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if rewritten != srcPath {
		t.Fatalf("opaque png should not be rewritten, got %s", rewritten)
	}
	if tmp != "" {
		t.Fatalf("opaque png should not create temp file, got %s", tmp)
	}
}

func TestExtractResponseTextPrefersOutputText(t *testing.T) {
	raw := []byte(`{"output_text":"优化后的 prompt"}`)
	if got := extractResponseText(raw); got != "优化后的 prompt" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractResponseErrorMessage(t *testing.T) {
	raw := []byte(`{"error":{"message":"boom"}}`)
	if got := extractResponseErrorMessage(raw); got != "boom" {
		t.Fatalf("got %q", got)
	}
}

func TestOptimizePromptRejectsEmptyPrompt(t *testing.T) {
	if _, err := optimizePromptWithLLM(t.Context(), "https://example.com", "sk-test", "", "generate", "   ", nil, client.ProxyConfig{}, false); err == nil || !strings.Contains(err.Error(), "提示词") {
		t.Fatalf("expected prompt error, got %v", err)
	}
}

func TestDescribePromptRequiresCanvasImage(t *testing.T) {
	if _, err := optimizePromptWithLLM(t.Context(), "https://example.com", "sk-test", "", "describe", "", nil, client.ProxyConfig{}, false); err == nil || !strings.Contains(err.Error(), "画布图片") {
		t.Fatalf("expected canvas image error, got %v", err)
	}
}

func TestCriticRequiresCandidateImages(t *testing.T) {
	if _, err := optimizePromptWithLLM(t.Context(), "https://example.com", "sk-test", "", "critic", "{}", nil, client.ProxyConfig{}, false); err == nil || !strings.Contains(err.Error(), "候选图片") {
		t.Fatalf("expected critic image error, got %v", err)
	}
}

func TestApplyCriticTextFormatUsesResponsesJSONSchema(t *testing.T) {
	schema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []any{"schemaVersion"},
		"properties": map[string]any{
			"schemaVersion": map[string]any{"const": float64(1)},
		},
	}
	request, err := json.Marshal(map[string]any{"responseSchema": schema})
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{"model": "gpt-5.5"}
	if err := applyCriticTextFormat(payload, string(request)); err != nil {
		t.Fatal(err)
	}

	text, ok := payload["text"].(map[string]any)
	if !ok {
		t.Fatalf("missing text config: %#v", payload["text"])
	}
	format, ok := text["format"].(map[string]any)
	if !ok {
		t.Fatalf("missing text format: %#v", text["format"])
	}
	if format["type"] != "json_schema" || format["name"] != "taste_critic_response" || format["strict"] != true {
		t.Fatalf("unexpected text format: %#v", format)
	}
	if !reflect.DeepEqual(format["schema"], schema) {
		t.Fatalf("schema changed: %#v", format["schema"])
	}
}

func TestApplyCriticTextFormatRejectsMissingSchema(t *testing.T) {
	if err := applyCriticTextFormat(map[string]any{}, `{}`); err == nil || !strings.Contains(err.Error(), "responseSchema") {
		t.Fatalf("expected responseSchema error, got %v", err)
	}
}

func TestPrepareUploadSourcePathsReturnsOpaquePath(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "opaque.png")
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	f, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	paths, cleanup, err := prepareUploadSourcePaths([]string{srcPath})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if len(paths) != 1 || paths[0] != srcPath {
		t.Fatalf("unexpected paths: %#v", paths)
	}
}
