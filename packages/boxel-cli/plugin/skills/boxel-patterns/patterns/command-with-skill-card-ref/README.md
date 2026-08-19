---
validated: source-proven
---

# command-with-skill-card-ref — Kick off an AI conversation from a card

**What this gives you:** A button (or other action) on a card that opens an AI assistant room, pre-loaded with a specific Skill card and any cards attached as context. Optionally pin the LLM mode (`ask` vs `act`) so the conversation starts in the right posture.

**When to use:** The card has a clear "send to AI for help" affordance — generating a report, suggesting an avatar, kicking off classification, drafting a response. Any time a card wants to *delegate* to an LLM with framing.

**The insight:** Skill cards have URLs. You can construct one at runtime relative to your own module via `new URL('../Skill/<skill-name>', import.meta.url)`, pass it to `UseAiAssistantCommand` along with the `attachedCards`, and the host opens an AI room already primed. Without this pattern, every AI-touching card invents its own one-off prompt-stuffing.

**Recipe shape:**

1. Build the skill-card ID with `new URL('../Skill/your-skill', import.meta.url)`. Add `@ts-expect-error import.meta` if TS complains.
2. Construct an instance of your input card with the data to attach.
3. Call `UseAiAssistantCommand` with `{ skillCardId, attachedCards, llmMode: 'ask' | 'act' }`.
4. Optionally chain `SetActiveLLMCommand` to pin the model.

**Gotchas:**
- `import.meta.url` needs the `@ts-expect-error` comment until the host's tsconfig is updated.
- The Skill card you reference must exist in a sibling `Skill/` folder.
- `attachedCards` is an array even when you have only one.

**Source:** catalog-realm `commands/generate-daily-report.gts:97-111`, `commands/suggest-avatar.gts:27-48`. Current canonical use in `boxel-catalog/catalog-app/resources/helpers/listing-action-resolver.gts`.

**Note on naming:** The host command lives at `@cardstack/boxel-host/tools/ai-assistant` (current, May 2026) — older docs may still reference `commands/use-ai-assistant`. The default-exported class is still `UseAiAssistantCommand` either way.

**See also:** `command-typed-with-progress` (for tracked progressStep), `integrate-openrouter-image-generation` (for generated image workflows).
