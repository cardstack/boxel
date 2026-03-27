# OpenRouter Multimodal File Type Support Plan

## Goal
Support all OpenRouter multimodal input file types end-to-end in Boxel AI prompts, not just images.

## Source
OpenRouter multimodal overview:
- https://openrouter.ai/docs/guides/overview/multimodal/overview

## What OpenRouter Supports
- Images (for example: PNG, JPEG, WEBP, GIF)
- PDFs (`application/pdf`)
- Audio inputs (for example: wav/mp3/aiff/aac/ogg/flac/m4a/pcm16/pcm24)
- Video inputs (for example: mp4/mpeg/mov/webm)

## Current State (Observed)
- Upload MIME inference now correctly recovers binary types from realm files when fetch returns generic MIME.
- Prompt construction currently sends:
  - text parts for text attachments
  - `image_url` parts for image attachments
- Non-text and non-image attachments (including PDFs/audio/video) are currently reduced to metadata text and not sent as multimodal payload data.

## Plan

### Phase 1: Expand Prompt Part Types ✅

Update runtime-common AI message part types so prompts can represent all needed OpenRouter content parts.

Target file: `packages/runtime-common/ai/types.ts`

New types added (matching OpenRouter payload schemas):

```ts
// PDF / generic file attachments
export type FileContentPart = {
  type: 'file';
  file: {
    filename: string;
    file_data: string; // base64 data URL (data:application/pdf;base64,...) or public URL
  };
  cache_control?: { type: 'ephemeral' };
};

// Audio input (base64 only — URLs not supported by OpenRouter)
export type InputAudioContentPart = {
  type: 'input_audio';
  input_audio: {
    data: string;   // raw base64 (no data: prefix)
    format: string;  // wav | mp3 | aiff | aac | ogg | flac | m4a | pcm16 | pcm24
  };
  cache_control?: { type: 'ephemeral' };
};

// Video input
export type VideoContentPart = {
  type: 'video_url';
  video_url: {
    url: string; // base64 data URL or public URL
  };
  cache_control?: { type: 'ephemeral' };
};
```

`ContentPart` union expanded:
```ts
export type ContentPart =
  | TextContent
  | ImageContentPart
  | FileContentPart
  | InputAudioContentPart
  | VideoContentPart;
```

All new types are exported for use by `prompt.ts` and other consumers.

### Phase 2: Build Correct Attachment Parts ✅

Updated attachment-to-prompt conversion logic in `packages/runtime-common/ai/prompt.ts`.

Changes:
- Added MIME helpers: `isPdfContentType`, `isAudioContentType`, `isVideoContentType`, `audioFormatFromMime`
- `buildAttachmentsMessagePart` now returns `{ text, mediaParts: ContentPart[] }` (was `{ text, imageUrls }`)
- Single loop over attached files dispatches by MIME type:
  - `image/*` → `image_url` part (unchanged behavior)
  - `application/pdf` → `file` part with base64 data URL in `file_data`
  - `audio/*` → `input_audio` part with raw base64 + format string
  - `video/*` → `video_url` part with base64 data URL
  - other → falls through to metadata-only text (unchanged)
- All media sourceUrls are omitted from the text fallback representation
- Caller in `buildPromptForModel` updated to spread `mediaParts` into `ContentPart[]`
- Tool-result caller unchanged (only uses `.text`)

### Phase 3: MIME Inference Coverage ✅

Root-cause fix: `realm.ts:getSourceOrRedirect` hardcoded `content-type: text/plain; charset=utf-8`
for all `application/vnd.card+source` responses, including binary files. Changed to
`inferContentType(handle.path)` so the realm returns the correct MIME (e.g. `application/pdf`,
`audio/mpeg`, `video/mp4`) at the source.

Additional fixes:
- `infer-content-type.ts`: Added `.ts` → `text/typescript` override (mime-types maps `.ts` to `video/mp2t`)
- `prompt.ts` `AUDIO_MIME_TO_FORMAT`: Added `audio/wave`, `audio/x-aac`, `audio/x-flac` variants

Tests added:
- `card-source-endpoints-test.ts`: Card-source GET returns correct content-type for image/PDF/audio/video
- `file-def-manager-canonicalize-test.ts`: `inferContentType` covers PDF, audio, and video extensions

### Phase 4: Download/Encoding Utilities ✅ (no changes needed)

`downloadFileAsBase64DataUrl` in `matrix-utils.ts` already reads binary content via `arrayBuffer`
and base64-encodes it. Phase 2 uses it for all multimodal types. `downloadFile` remains text-only,
which is correct for its callers (text attachments, card JSON, command definitions).

### Phase 5: Model Capability Gating ✅

Prevent invalid multimodal payloads for models that do not support specific modalities.

Changes:

- **`packages/base/system-card.gts`**: Added `inputModalities` field (`containsMany(StringField)`) to `ModelConfiguration`
- **`packages/base/matrix-event.gts`**: Added `inputModalities?: string[]` to `ActiveLLMEvent.content`
- **`packages/host/app/services/matrix-service.ts`**: `sendActiveLLMEvent` now includes `inputModalities` from model configuration
- **`packages/runtime-common/ai/prompt.ts`**:
  - `getActiveLLMDetails` returns `inputModalities` from the active LLM event
  - `getPromptParts` calls `getActiveLLMDetails` before `buildPromptForModel` so modalities are available
  - `buildPromptForModel` accepts and forwards `inputModalities` parameter
  - `buildAttachmentsMessagePart` accepts `inputModalities` parameter
  - New `requiredModality(contentType)` helper maps MIME types to OpenRouter modality strings (`image`, `file`, `audio`, `video`)
  - Gating logic: when `inputModalities` is set, media parts for unsupported modalities are skipped
  - Warning text appended listing files not sent due to model limitations
  - When `inputModalities` is undefined (no model config), all modalities are sent (no gating)

### Phase 6: Tests ✅

Added focused tests around prompt assembly, MIME handling, and modality gating.

**New test file: `packages/ai-bot/tests/modality-test.ts`** (10 tests)
- `requiredModality` maps image/PDF/audio/video MIME types to correct modality strings
- `requiredModality` returns undefined for non-multimodal types (text, JSON, octet-stream)
- `modalityLabel` returns human-readable labels for each modality
- `isImageContentType`, `isPdfContentType`, `isAudioContentType`, `isVideoContentType` correctly classify types

**Added to `packages/ai-bot/tests/prompt-construction-test.ts`** (5 tests)
- PDF attachment produces native `file` content part with base64 data URL in `file_data`
- Audio attachment produces native `input_audio` content part with raw base64 and format string
- Video attachment produces native `video_url` content part with base64 data URL
- Unsupported modality is gated when `inputModalities` is set (PDF excluded, warning text present)
- All modalities sent when `inputModalities` is undefined (no gating, no warning)

**Previously added in Phase 3:**
- `card-source-endpoints-test.ts`: Realm returns correct content-type for image/PDF/audio/video
- `file-def-manager-canonicalize-test.ts`: `inferContentType` covers PDF, audio, and video extensions

## Suggested MIME Mapping
- `application/pdf` -> `file`
- `audio/wav`, `audio/mpeg`, `audio/aac`, `audio/ogg`, `audio/flac`, `audio/mp4`, etc. -> `input_audio`
- `video/mp4`, `video/mpeg`, `video/quicktime`, `video/webm` -> `video_url`/file form

## Rollout Strategy
1. Ship types + prompt builder support for PDF first (lowest risk, immediate value).
2. Add audio support next.
3. Add video support last (higher provider variance).
4. Add capability gating and fallback messaging before broad enablement.

## Success Criteria
- Uploaded supported files are transmitted to OpenRouter in multimodal payload form, not metadata-only text.
- No regressions for text/image behavior.
- Unsupported file/model combinations fail gracefully with explicit fallback messaging.
