---
validated: source-proven
---

# integrate-openrouter-image-generation — Generate images through OpenRouter

**What this gives you:** A Boxel command pattern that calls OpenRouter image-capable chat models, extracts the returned data URL, writes it as a real realm file with `WriteBinaryFileCommand`, and links it through `ImageDef`.

**Use this for all core image-generation app work.** Provider-specific image APIs and deprecated image-card persistence belong outside the portable skill tree.

## Recommended Models

Default to OpenRouter image-capable models, in this order:

1. `google/gemini-2.5-flash-image` — recommended default for most app-generated images.
2. `openai/gpt-5.4-image-2` — recommended ChatGPT/OpenAI option for high-end multimodal workflows.
3. `openai/gpt-5-image-mini` — cheaper ChatGPT/OpenAI option for lightweight generation.
4. `google/gemini-3.1-flash-image-preview` — use when extended aspect ratios or preview-only capability are explicitly desired.

OpenRouter image requests should use `/api/v1/chat/completions` with `modalities: ['image', 'text']`. Generated images arrive as base64 data URLs in `choices[0].message.images`.

## Persistence Rule

Never save the returned `data:image/...;base64,...` string in a card field. Strip the prefix, write the bytes with `WriteBinaryFileCommand`, then assign an `ImageDef` / `PngDef` link on the domain card.

**Source:** OpenRouter image-generation docs and `packages/host/app/tools/screenshot-card.ts` for the realm-file persistence pattern.
