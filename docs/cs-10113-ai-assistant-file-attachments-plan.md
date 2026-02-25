# CS-10113 Plan: AI Assistant File Attachments (Any File)

## Goals
- Let AI Assistant users attach files from the plus menu before sending a message.
- Support both sources: existing realm files and files from local computer.
- Preserve current AI Assistant ergonomics while adding upload progress, remove, retry, and send gating.
- Use Matrix content store + FileDef pipeline as the canonical attachment transport.

## Product Decisions Captured
- Scope is any file type.
- Max file size uses existing realm file size limit constant (`environmentService.fileSizeLimitBytes`).
- No cap on attachments per message or per conversation.
- Realm picker should include any accessible realm (same behavior as current chooser).
- For both realm and local sources: upload bytes to Matrix content store and send FileDef payloads backed by Matrix media.
- Create in-memory FileDef attachment records immediately during attach flow.
- Deduplicate by content hash.
  - Conversation-level dedupe is silent.
  - Matrix content-store dedupe reuses existing media by content hash.
- If any attachment upload fails, `Send` is blocked until retry succeeds or the failed attachment is removed.
- Duplicate attachments can still appear as pills on new messages.
- If model cannot natively consume a MIME type (known ahead of time), send metadata only, not file bytes/content.
- For unreadable/unsupported upload failures, block send and show error.
- Realm attachments are byte snapshots at attach time (immutable thereafter).
- Removing pre-send attachment does not hard-delete Matrix media immediately (leave for cleanup/GC).
- Preserve attachment order into model input.
- Follow-up context policy:
  - Automatically include only attachments on the current message.
  - Older attachments available only via tool call.
  - Tool calls may fetch only from prior turns in the same conversation.
  - No additional user confirmation required.
- Credits behavior remains unchanged.
- UX acceptance includes upload progress, atom/pill representation, remove action, retry on failure.
- No mobile requirements in this phase.

## Assumptions
- Existing AI Assistant room message schema remains `data.attachedFiles` (SerializedFileDef list).
- Existing file chooser modal can be extended for AI-specific upload behavior without regressing non-AI file-link workflows.
- Model capability detection (MIME compatibility) will be implemented as a local capability map keyed by active model ID until SystemCard exposes richer per-model media capabilities.
- Conversation scoping for tool-based file fetch can be enforced in host command execution for `read-file-for-ai-assistant`.

## Implementation Plan

### 1. Attachment domain model and send gating
- Introduce pending attachment state for AI drafts (upload status + error + serialized file def + hash).
- Extend send eligibility so files count as valid send content and failed uploads block send.
- Keep attachment order stable from UI list through message serialization.

Target files:
- `packages/host/app/components/matrix/room.gts`
- `packages/host/app/services/matrix-service.ts`
- `packages/host/app/services/local-persistence-service.ts`

### 2. File picker and upload UX
- Reuse plus-menu path (`Attach a File`) and chooser modal.
- Keep realm picker behavior unchanged (all accessible realms).
- Add/extend AI attach mode in chooser:
  - Realm file selection path.
  - Local file upload path with progress + retry + error.
- For local files, avoid writing to realm storage; create in-memory FileDef and upload directly to Matrix.
- For realm files, resolve selected file and snapshot bytes at attach time.

Target files:
- `packages/host/app/components/ai-assistant/attachment-picker/attach-button.gts`
- `packages/host/app/components/operator-mode/choose-file-modal.gts`
- `packages/host/app/services/file-upload.ts`
- `packages/host/app/components/ai-assistant/attachment-picker/attached-items.gts`
- `packages/host/app/components/file-pill.gts`

### 3. Matrix upload pipeline and dedupe
- Generalize FileDefManager upload path to support both:
  - realm-backed source URLs
  - in-memory local blobs/files
- Compute content hash from bytes for binary-safe dedupe.
- Reuse `contentHashCache` to dedupe Matrix media uploads.
- Add conversation-level dedupe by hash in AI draft state while preserving per-message pill rendering.

Target files:
- `packages/host/app/lib/file-def-manager.ts`
- `packages/host/app/services/matrix-service.ts`
- `packages/host/tests/helpers/mock-matrix/_client.ts`

### 4. Prompt construction for multimodal + metadata fallback
- Keep message-level rule: only current message attachments auto-included.
- For models that support native media for a MIME category, send multimodal content parts (`text` + `image_url` etc where supported).
- For non-supported MIME types, include metadata-only attachment section (name, type, hash, source/url).
- Preserve current behavior for textual files where content is useful inline.
- Ensure unsupported file types no longer surface as silent backend fetch errors when capability is known in advance.

Target files:
- `packages/runtime-common/ai/prompt.ts`
- `packages/runtime-common/ai/types.ts`
- `packages/runtime-common/ai/matrix-utils.ts`
- `packages/ai-bot/main.ts` (if request shaping needs model-aware content handling)

### 5. Tool-call retrieval policy (same conversation only)
- Enforce that `read-file-for-ai-assistant` can only fetch files that were attached in the same room/conversation history.
- Reject out-of-scope file requests with clear command result failure reason.
- No confirmation prompt required for in-scope file fetches.

Target files:
- `packages/host/app/commands/read-file-for-ai-assistant.ts`
- `packages/host/app/services/command-service.ts`
- `packages/host/app/resources/room.ts` (if helper needed for attachment lookup by room history)

## UX States
- Attachment added and uploading: show pending/upload progress in picker/inline area.
- Upload success: render standard file pill (atom display).
- Upload failure: show inline error and retry affordance; keep item removable.
- Send disabled conditions:
  - no message/cards/files
  - any pending failed attachment
  - any still-uploading attachment (to avoid partial send race)
- Remove attachment: immediate UI removal from draft; no immediate media deletion required.

## Acceptance Criteria (Testable)
- User can attach from realm and from local computer via plus menu.
- User can attach multiple files in one draft and remove any before send.
- Upload progress is visible for local uploads.
- Failed uploads show error and retry.
- Send is blocked when any attachment is failed or still uploading.
- Successful send includes attached files in the outgoing event in selected order.
- Duplicate file attach in same conversation reuses content hash/media silently.
- Follow-up message does not auto-resend previous attachments unless attached again.
- Model/tool can request prior attached file only within same conversation.
- Unsupported-by-model MIME types are represented as metadata (not raw content payload).
- Realm-sourced attachment content is snapshot-consistent even if source realm file later changes.

## Testing Notes

### Host acceptance/integration
- Add/extend AI assistant attachment tests:
  - plus-menu attach from realm
  - plus-menu upload local file
  - upload progress, error, retry, remove
  - send blocking behavior for failed/uploading attachments
  - duplicate attach dedupe behavior
  - order preservation
- Candidate suites:
  - `packages/host/tests/acceptance/ai-assistant-test.gts`
  - `packages/host/tests/integration/components/ai-assistant-panel/sending-test.gts`
  - `packages/host/tests/acceptance/file-chooser-test.gts` (ensure non-AI chooser behavior stays intact)

### Runtime-common / ai-bot tests
- Update prompt construction tests for multimodal + metadata fallback and message-level inclusion policy.
- Candidate suites:
  - `packages/ai-bot/tests/prompt-construction-test.ts`

### Command security/scope tests
- Add integration coverage for same-conversation-only tool file fetch rule.
- Candidate suites:
  - `packages/host/tests/integration/commands/read-file-for-ai-assistant-test.gts`

### Lint and verification
- Run lint in modified packages before commit per repo policy.
  - `packages/host`: `pnpm lint`
  - `packages/runtime-common`: `pnpm lint`
  - `packages/ai-bot`: `pnpm lint` (if modified)

## Risks and Mitigations
- Risk: Regressing generic file chooser behavior used outside AI assistant.
  - Mitigation: explicit AI mode path + preserve existing chooser contract + acceptance tests.
- Risk: Binary hashing/upload bugs from string-only assumptions.
  - Mitigation: centralize byte hashing and add binary fixture tests.
- Risk: Model capability mismatch leads to wrong payload format.
  - Mitigation: capability map with safe default (metadata-only).
- Risk: Tool-call scope bypass for arbitrary URLs.
  - Mitigation: enforce room-history attachment allowlist in command execution.

## Out of Scope for This Ticket
- Mobile-specific UX work.
- New billing rules.
- Cross-conversation attachment retrieval.
- Analytics/events instrumentation.
