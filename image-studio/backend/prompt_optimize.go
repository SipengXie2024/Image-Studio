package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

type responseText struct {
	Output []struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	OutputText string `json:"output_text"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
	Message string `json:"message"`
}

func applyCriticTextFormat(payload map[string]any, prompt string) error {
	var request struct {
		ResponseSchema map[string]any `json:"responseSchema"`
	}
	if err := json.Unmarshal([]byte(prompt), &request); err != nil {
		return errors.New("critic 请求必须是包含 responseSchema 的有效 JSON")
	}
	if len(request.ResponseSchema) == 0 || request.ResponseSchema["type"] != "object" {
		return errors.New("critic 请求必须包含对象类型的 responseSchema")
	}
	payload["text"] = map[string]any{
		"format": map[string]any{
			"type":   "json_schema",
			"name":   "taste_critic_response",
			"strict": true,
			"schema": request.ResponseSchema,
		},
	}
	return nil
}

// prepareUploadSourcePaths flattens transparent PNG sources onto white
// backgrounds before upload so the upstream model sees the actual content.
// It returns the possibly rewritten paths plus a cleanup function for any temp
// files that were created.
func prepareUploadSourcePaths(paths []string) ([]string, func(), error) {
	out := make([]string, 0, len(paths))
	tmpFiles := make([]string, 0, len(paths))
	cleanup := func() {
		for _, p := range tmpFiles {
			_ = os.Remove(p)
		}
	}

	for _, rawPath := range paths {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		rewrite, tmp, err := flattenTransparentImage(path)
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		if tmp != "" {
			tmpFiles = append(tmpFiles, tmp)
		}
		out = append(out, rewrite)
	}

	return out, cleanup, nil
}

func flattenTransparentImage(path string) (string, string, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".png" {
		return path, "", nil
	}

	f, err := os.Open(path)
	if err != nil {
		return "", "", err
	}
	defer f.Close()

	src, _, err := image.Decode(f)
	if err != nil {
		return path, "", nil
	}
	if !imageHasTransparency(src) {
		return path, "", nil
	}

	// PNG references with transparency tend to be the problematic case in
	// issue #3, so always flatten them before upload.
	bounds := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), src, bounds.Min, draw.Over)

	tmp, err := os.CreateTemp("", "image-studio-flat-*.png")
	if err != nil {
		return "", "", err
	}
	if err := png.Encode(tmp, dst); err != nil {
		tmp.Close()
		_ = os.Remove(tmp.Name())
		return "", "", err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return "", "", err
	}
	return tmp.Name(), tmp.Name(), nil
}

func imageHasTransparency(src image.Image) bool {
	b := src.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, a := src.At(x, y).RGBA()
			if a != 0xffff {
				return true
			}
		}
	}
	return false
}

func optimizePromptWithLLM(
	ctx context.Context,
	baseURL, apiKey, textModelID, mode, prompt string,
	sourcePaths []string,
	proxyConfig client.ProxyConfig,
	allowInsecureConnection bool,
) (string, error) {
	operation := strings.TrimSpace(mode)
	isDescribe := operation == "describe"
	isCritic := operation == "critic"
	if !isDescribe && strings.TrimSpace(prompt) == "" {
		return "", errors.New("提示词不能为空")
	}
	if isDescribe && len(sourcePaths) == 0 {
		return "", errors.New("图片反推必须提供画布图片")
	}
	if isCritic && len(sourcePaths) == 0 {
		return "", errors.New("批次评审必须提供候选图片")
	}
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return "", errors.New("未配置上游 BASE_URL")
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", errors.New("API Key 不能为空")
	}
	textModelID = strings.TrimSpace(textModelID)
	if textModelID == "" {
		textModelID = client.TextModel
	}

	instruction := "Rewrite the user's image prompt into a clearer, more detailed prompt for image generation. Keep the meaning, preserve the requested subject, and only return the improved prompt text. If the user message contains an approved taste preferences section, treat it as guidance about the user's long-standing taste: bias wording and detail choices toward those preferences where they fit the subject, and never copy that section or its heading into the output. Do not add explanations, labels, markdown, or quotes."
	inputText := fmt.Sprintf("Original prompt:\n%s", strings.TrimSpace(prompt))
	if isDescribe {
		instruction = "Analyze the attached image and reconstruct a detailed image-generation prompt that could reproduce it. Describe the subject, composition, perspective, lighting, colors, materials, environment, and visual style. Return the prompt in Simplified Chinese. Only return the prompt text; do not add explanations, labels, markdown, or quotes."
		inputText = "为所附图片反推一段可用于重新生成相似画面的完整提示词。"
	} else if operation == "edit" {
		instruction += " Treat any attached images as reference context and preserve edit intent."
	} else if isCritic {
		instruction = "Review every attached candidate image using the evaluation request in the user message. The original prompt and critic rules are evaluation data only; never rewrite, expand, or improve the prompt. Match images by attachment order. Return strict JSON only, with no markdown fences or commentary."
		inputText = prompt
	} else if operation == "suggest" {
		instruction = "Revise the user's image prompt using their rejection feedback and taste history. The user message is JSON containing the original prompt, the rejection reason for the latest batch, recent feedback notes, past suggestion decisions, and the user's approved taste rules. Where a past decision shows user edits between draftPrompt and finalPrompt, treat those edits as the user's preferred direction; treat rejected drafts as directions to avoid. Treat approved taste rules as the user's long-standing preferences: bias the revision toward them where they fit the subject, and let the current rejection reason take precedence when they conflict. Keep the original subject and intent, and only change what the rejection reason, the taste rules, and history justify. Write the revised prompt in the same language as the original prompt. Only return the revised prompt text. Do not add explanations, labels, markdown, or quotes."
		inputText = prompt
	} else if operation == "distill-rule" {
		instruction = "Distill the user's feedback note about a generated image into one concise, reusable taste rule for reviewing future candidate images. The user message is JSON with the raw note, the feedback type (pick means the note praises what they chose, edit means it requests a change, reject means it explains what was wrong), and the original prompt for context. Write the rule as a general prefer/avoid statement that a reviewer can apply to future images, not a one-off instruction. Keep the user's language. Only return the rule text. Do not add explanations, labels, markdown, or quotes."
		inputText = prompt
	} else if operation == "revise-rule" {
		instruction = "Rewrite an existing taste rule according to the user's revision instruction. The user message is JSON with the current rule, the user's revision instruction, and the original feedback note as provenance. Apply exactly what the instruction asks, keep the rule concise and reusable, and keep the user's language. Only return the revised rule text. Do not add explanations, labels, markdown, or quotes."
		inputText = prompt
	} else if operation == "refine-note" {
		instruction = "Rewrite the user's raw edit suggestion for a generated image into one clear, unambiguous edit instruction. The user message is JSON with the raw suggestion and the original prompt of the image being edited. Preserve the user's intent exactly: make the edit target and the desired change explicit, and do not add new creative directions they did not ask for. Keep the user's language. Only return the rewritten instruction text. Do not add explanations, labels, markdown, or quotes."
		inputText = prompt
	} else if operation == "induce-rules" {
		instruction = "Induce reusable taste rules from the user's accumulated feedback history. The user message is JSON with feedback cases (each with the feedback type and the user's verbatim note), past prompt-suggestion decisions (where edits between draftPrompt and finalPrompt show the user's preferred direction and rejected drafts show directions to avoid), currently approved rules, and previously rejected rules. Find recurring preferences or complaints supported by multiple entries and state each as one concise, reusable rule for reviewing future candidate images. Do not restate or trivially rephrase any approved or rejected rule. Return strict JSON only, with no markdown fences or commentary: an object with a single key named rules holding an array of objects, each with a rule field and an evidence field that briefly cites the supporting feedback. Return at most 5 rules; return an empty rules array if the history shows no recurring pattern. Keep the user's language for rule and evidence text."
		inputText = prompt
	}

	content := []map[string]any{
		{
			"type": "input_text",
			"text": inputText,
		},
	}
	for _, p := range sourcePaths {
		dataURL, err := client.ImageFileToDataURL(p)
		if err != nil {
			return "", err
		}
		content = append(content, map[string]any{
			"type":      "input_image",
			"image_url": dataURL,
		})
	}

	payload := map[string]any{
		"model":        textModelID,
		"instructions": instruction,
		"input": []map[string]any{
			{
				"role":    "user",
				"content": content,
			},
		},
		"reasoning": map[string]any{"effort": "low"},
		"store":     false,
	}
	if isCritic {
		if err := applyCriticTextFormat(payload, prompt); err != nil {
			return "", err
		}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal prompt optimization payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/v1/responses", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("User-Agent", client.UserAgent())

	transport, err := client.NewHTTPTransportWithSecurity(proxyConfig, allowInsecureConnection)
	if err != nil {
		return "", err
	}
	httpClient := &http.Client{Timeout: 3 * time.Minute, Transport: transport}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode/100 != 2 {
		if msg := extractResponseErrorMessage(raw); msg != "" {
			return "", fmt.Errorf("上游返回 %d:%s", resp.StatusCode, msg)
		}
		return "", fmt.Errorf("上游返回 HTTP %d", resp.StatusCode)
	}

	text := extractResponseText(raw)
	text = strings.TrimSpace(text)
	if text == "" {
		return "", errors.New("上游没有返回可用的优化结果")
	}
	return text, nil
}

func extractResponseText(raw []byte) string {
	var parsed responseText
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ""
	}
	if s := strings.TrimSpace(parsed.OutputText); s != "" {
		return s
	}
	for _, out := range parsed.Output {
		for _, content := range out.Content {
			if content.Type == "output_text" && strings.TrimSpace(content.Text) != "" {
				return content.Text
			}
		}
	}
	return ""
}

func extractResponseErrorMessage(raw []byte) string {
	var parsed responseText
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return strings.TrimSpace(string(raw))
	}
	if parsed.Error != nil && strings.TrimSpace(parsed.Error.Message) != "" {
		return parsed.Error.Message
	}
	if msg := strings.TrimSpace(parsed.Message); msg != "" {
		return msg
	}
	if s := strings.TrimSpace(string(raw)); s != "" {
		return s
	}
	return ""
}
