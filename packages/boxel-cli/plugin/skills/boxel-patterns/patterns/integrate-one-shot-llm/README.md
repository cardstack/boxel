---
validated: source-proven
---

# integrate-one-shot-llm — Call an LLM through OpenRouter via OneShotLlmRequestCommand

**What this gives you:** A single typed Command call (`OneShotLlmRequestCommand`) that takes a `systemPrompt` + `userPrompt` + `llmModel` (e.g. `'anthropic/claude-haiku-4.5'`, `'openai/gpt-4.1-nano'`), routes through OpenRouter, and returns the model's output. No raw fetch, no API key management — the host handles auth.

**When to use:** Any card that needs to call an LLM for classification, extraction, summarization, code suggestion, parsing free-form input, etc. Quick AI calls inside a Glimmer component or another Command.

**The insight:** Boxel's host already has OpenRouter credentials configured per realm. `OneShotLlmRequestCommand` is the canonical "give me model output" primitive — it abstracts the API call, request shape, and response parsing. Pair it with `restartableTask` from the component side. For _interactive_ multi-turn flows, use `command-with-skill-card-ref` instead — `OneShotLlmRequest` is for one-shot, no-conversation calls.

**Recipe shape:**

```ts
import OneShotLlmRequestCommand from '@cardstack/boxel-host/tools/one-shot-llm-request';

// Inside a component method or Command.run:
const llm = new OneShotLlmRequestCommand(this.commandContext);
const result = await llm.execute({
  systemPrompt: 'You are a JSON extractor. Output only JSON.',
  userPrompt: rawText,
  llmModel: 'anthropic/claude-haiku-4.5',
  // Optional: codeRef to constrain output shape to a specific result CardDef
});
const output =
  (result as any)?.output ?? (result as any)?.attributes?.output ?? '';
```

**Model strings (current):**

- `anthropic/claude-haiku-4.5` — cheap, fast, good for parsing/classification.
- `anthropic/claude-sonnet-4.6` — default for code-generation.
- `openai/gpt-4.1-nano` — alternative cheap option.
- `openai/gpt-5` and higher — for complex reasoning.

**Gotchas:**

- The result shape varies — typed via the optional `codeRef` argument, untyped otherwise. Always unwrap defensively: `result?.output ?? result?.attributes?.output ?? ''`.
- Wrap calls in `restartableTask` if invoked from a component — abandonment on cancel is essential.
- For batch calls, prefer one large prompt (the "N-in-1 markdown" pattern from BSL-STUDY V1's tessar-status entry) rather than N parallel calls.
- Costs accumulate — pick the cheapest model that gets the job done. Haiku 4.5 / GPT nano are the typical defaults for classification.

**Source:** `boxel-catalog/04868f-mortgage-calculator/components/isolated-template.gts` (QuickFill from free text), `boxel-catalog/commands/listing-create.ts:loop` (AI-assisted listing scaffold).

**See also:** `command-with-skill-card-ref` (for multi-turn conversations), `command-typed-with-progress` (for progress-tracked AI calls), `integrate-send-request-via-proxy` (for arbitrary HTTP to AI APIs not behind OneShot).
