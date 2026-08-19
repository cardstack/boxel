# AI image models — current valid IDs

When generating images for card mockups, sample data, or asset fills, this reference lists known-working model IDs at the relevant providers. Validate model IDs against the provider's models endpoint before assuming an ID is current — older guessed IDs commonly 404.

## Google Gemini (direct API)

For direct `generateContent` calls using a Google/Gemini API key, the verified model IDs as of 2026-05-22 are:

| Model ID | Nickname | Notes |
|---|---|---|
| `gemini-3-pro-image-preview` | Nano Banana Pro | Best-quality preview |
| `gemini-2.5-flash-image` | Nano Banana | Faster, lower-cost |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | Newer flash preview |

**Verified via the models-list endpoint:**

```sh
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_KEY" \
  | grep -A 1 '"name":' \
  | grep -E "image|generateContent"
```

**Returns 404 with this API key/version** (older guessed IDs):
- `gemini-2.5-flash-image-preview`
- `gemini-2.0-flash-preview-image-generation`

## Gemini via OpenRouter (preferred for in-card commands)

Inside Boxel cards, use the OpenRouter proxy via `SendRequestViaProxyCommand` so the API key stays server-side and the call routes through the boxel-host's request infrastructure:

```ts
model: 'google/gemini-2.5-flash-image-preview'
```

Aspect ratio MUST be in `extra_body.generationConfig.imageConfig.aspectRatio`, not at the top level.

For the full in-card integration shape — request body, response shape, parallel-generation pattern, upload to CloudflareImage — see [`integrate-openrouter-image-generation`](../patterns/integrate-openrouter-image-generation/) in the patterns directory.

## OpenAI / ChatGPT image models (when explicitly requested)

When the user asks for ChatGPT-style images instead of Gemini, route through OpenRouter with model IDs like `openai/dall-e-3` or `openai/gpt-image-1`. Verify the current OpenRouter catalog before use — IDs change.

## When to use each

| Context | Recommended path |
|---|---|
| Generating mockup/hero images for a `MicroMockups` card | Gemini direct API (Nano Banana Pro), saved as realm files via `WriteBinaryFileCommand` |
| In-card AI image generation feature | OpenRouter proxy + `UploadImageCommand` into the realm |
| Generic placeholder gradient | CSS `linear-gradient(...)`, no model needed |

For card-side image generation patterns, see `boxel-patterns/patterns/integrate-openrouter-image-generation/` and the brand-guided imagery section in `boxel/references/design-playbook.md` Stage 1.
