---
validated: source-proven
---

# automate-image-steering — Iteratively refine a generated image with initial prompt + steering input + image lineage

**What this gives you:** A reusable shape for building **steerable image generators** — apps where the user starts from a seed prompt, then iteratively pushes the generation toward what they want by issuing short steering commands ("warmer light", "tighter crop", "older clothing"). Each step keeps the _identity_ of the original subject while applying the user's latest direction. The model gets enough lineage (initial prompt + evolved prompt + first image + latest image) to refine instead of drift.

**When to use:**

- **Photo / illustration apps with voice or text steering.** Take a base subject and let the user direct the camera ("zoom in", "side angle", "golden hour").
- **Character / persona generators.** Lock the identity from the first image and only adjust costume / setting / expression.
- **Avatar studios, ad-creative tools, virtual try-on.** Same subject, varied scenes.
- **Anything that would feel like "regenerate" if you only passed the prompt.** The unsteered single-shot pattern (see `integrate-thumbnail-card-ai`) loses the chain. Use this when each generation should _evolve_ the previous one.

**The insight:** A single-shot image call drifts. Pass the prompt twice and you'll get two unrelated outputs. To make iteration feel steerable, the model needs:

1. **An immutable anchor** — the initial subject description that should survive every step.
2. **An evolved description** — what the chain has become after the user's edits so far.
3. **An explicit steering command** — the user's _current_ input, declared as priority-1 in the prompt body.
4. **A grounding image** — the first stable output of the chain, attached so the model can lock identity.
5. **A modification-target image** — the _latest_ output, attached as "this is what to change."

The prompt body explicitly narrates each image's role ("FIRST IMAGE = baseline / maintain identity"; "LAST IMAGE = modify per user request"). Without those role declarations the model averages or gets confused. With them, it actually refines.

A small bounded `imageHistory` (last N=4) supports an "undo" UX, a filmstrip, or a lineage view — but the model only sees the first + current images, not the whole chain.

## State shape

Inside the consumer card's Component (all `@tracked`):

```ts
@tracked firstImage: string | null = null;     // grounding reference; pinned on gen #1 or #2
@tracked currentImage: string | null = null;   // most recent output; the modification target
@tracked previousImage: string | null = null;  // optional, for filmstrip "before" comparison
@tracked imageHistory: Array<{
  image: string;
  version: string;
  timestamp: Date;
}> = [];                                       // bounded ring (last 4)
@tracked isGenerating = false;
@tracked errorMessage: string | null = null;
```

Plus two model-level fields:

```ts
@field subjectPrompt = contains(TextAreaField);  // immutable base subject (gen #1's seed)
@field generationCount = contains(StringField);  // bumped on each successful step
```

`currentImage` is in-memory only — base64 data URLs from the API response. Cards usually persist the final accepted image as an `ImageDef` via `WriteBinaryFileCommand` once the user is satisfied (see `integrate-filedef-generated-image`).

## The layered prompt template

Each generation builds a prompt with four labelled sections:

```
Generate image variation #{generationNum}:

ORIGINAL SUBJECT DESCRIPTION (BASE): "{subjectPrompt}"
CURRENT EVOLVED SUBJECT: "{currentSubject}"

PRIMARY USER MODIFICATION REQUEST: "{userInput}"
** PRIORITY: The user's command takes precedence over all preset parameters below. **

BASELINE PARAMETERS (Modify as directed by user):
{...optional preset block — camera, scene, mood, etc...}

IMAGE CONTEXT GUIDANCE:
• FIRST IMAGE (attached): baseline / grounding reference. Maintain the core subject and composition established here.
• LAST IMAGE (attached): what to modify. Apply the user's request to this most recent version.

EXECUTION INSTRUCTIONS:
1. PRIORITIZE USER REQUEST: "{userInput}" overrides any conflicting preset parameters.
2. Use the current evolved subject as the main focus: "{currentSubject}"
3. Keep the original subject essence: "{subjectPrompt}"
4. Use the first image to understand intended style, composition, subject positioning.
5. Apply the user modification to the last image while maintaining consistency with the first image.
6. User commands can modify: lighting, composition, mood, camera angle, focal length, depth of field, color grading, or any visual aspect.
7. Maintain visual continuity across the sequence unless explicitly directed otherwise.

Create a high-quality image following these guidelines, with user commands taking priority over preset parameters.
```

The `** PRIORITY: ... **` bolding and the numbered execution instructions aren't decorative — they materially change what Gemini Flash Image and the GPT-5 image models output. Strip them and you'll see the model average across the steering commands instead of obeying the latest one.

**Variants by chain position:**

- **First generation** (no images yet): the prompt block omits "FIRST IMAGE" / "LAST IMAGE" lines and adds `• FIRST GENERATION: Create initial image based on the original subject description and user request.`
- **Second generation** (`firstImage === currentImage`): attach only one image; the prompt block describes a single grounding/modification reference.
- **Later generations**: attach both. The two `image_url` entries in the `content[]` array let the model relate them.

## OpenRouter multimodal message shape

```ts
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: layeredPrompt },
      ...(firstImageB64
        ? [
            {
              type: 'image_url',
              image_url: { url: firstImageB64 },
            },
          ]
        : []),
      ...(currentImageB64 && currentImageB64 !== firstImageB64
        ? [
            {
              type: 'image_url',
              image_url: { url: currentImageB64 },
            },
          ]
        : []),
    ],
  },
];

const result = await new SendRequestViaProxyCommand(commandContext).execute({
  url: 'https://openrouter.ai/api/v1/chat/completions',
  method: 'POST',
  requestBody: JSON.stringify({
    model: 'google/gemini-2.5-flash-image',
    messages,
  }),
});
```

Use Gemini Flash Image as the default (it's the cheapest model that handles multi-image inputs reliably for this shape). ChatGPT-style image models also work; switch via `llmModel` arg if the user requests a specific feel.

## Post-generation state update

After extracting the new `dataUrl` from the response:

```ts
// 1. Push the current image into history (with dedup, bounded to last 4)
if (this.currentImage) {
  const isDuplicate = this.imageHistory.some(
    (item) => item.image === this.currentImage,
  );
  if (!isDuplicate) {
    this.imageHistory = [
      ...this.imageHistory.slice(-4),
      {
        image: this.currentImage,
        version: this.args.model.generationCount || '1',
        timestamp: new Date(),
      },
    ];
  }
}

// 2. Snapshot the previous, advance the current
this.previousImage = this.currentImage;
this.currentImage = dataUrl;

// 3. Pin the firstImage early in the chain (gen #1 or #2)
if (!this.firstImage && generationNum <= 2) {
  this.firstImage = dataUrl;
}

// 4. Bump the count
this.args.model.generationCount = String(generationNum);
```

The "pin firstImage on gen #1 or #2" rule is deliberate. Gen #1 is sometimes unsatisfactory (the user hasn't given any steering yet); allowing gen #2 to overwrite the grounding image lets the chain start from a slightly-corrected baseline. After that, the grounding image freezes — the model always sees the same first frame for identity continuity.

## Reset path

Provide a "start over" action that clears state but keeps the seed:

```ts
@action
reset() {
  this.currentImage = null;
  this.previousImage = null;
  this.firstImage = null;
  this.imageHistory = [];
  this.args.model.generationCount = '0';
  // subjectPrompt stays — that's the user's intent, not chain state
}
```

For a "branch from here" UX, copy a history entry into `firstImage` and `currentImage`, clear `imageHistory` beyond that point.

## Gotchas

- **Don't pass the whole history to the model.** Two images (first + current) is enough; more dilutes the steering signal and burns tokens for no quality gain. Use history for the UI, not the prompt.
- **`previousImage` is the diff target, not a model input.** It's there for the filmstrip "before / after" view; the model uses `currentImage` (which equals `previousImage` until the new one lands).
- **Avoid `imageHistory` unbounded growth.** `.slice(-4)` before pushing keeps it tight. Large image arrays in tracked state can balloon memory because each entry is a base64 data URL (~2 MB each).
- **Dedup before pushing to history.** A failed regeneration that returns the same image shouldn't double-up in the filmstrip.
- **Pin `firstImage` after a "stable" generation, not before.** The simplest rule (`if (!this.firstImage && generationNum <= 2)`) works for most apps. For higher-stakes chains, expose a "pin this as the reference" affordance.
- **The user input is a _short_ command, not a re-prompt.** "warmer light" → fine. "Generate a totally new scene of someone else in a different place" → throws the chain off. UI should hint at short directional commands; long re-prompts mean the user wants `reset()` + new seed.
- **Camera / scene preset blocks are optional but stabilize the chain.** Without them, the model improvises camera/composition every step. With them, the chain stays consistent unless the user explicitly says "wider angle" or "darker mood."
- **`@tracked` arrays mutate in place vs reassignment.** The `imageHistory = [...]` reassignment is required — `.push()` doesn't notify tracking. Same for `cameraParams = {...this.cameraParams, fooParam: x}` if you let the user adjust presets mid-chain.
- **Don't await each render.** The image-gen call takes 3–8 s; gate the button with `@tracked isGenerating` and disable input during the call. Spinner + log message keeps the UI from feeling stuck.
- **Steering is not a queue.** If the user fires two commands while a gen is in flight, the second one should _replace_ the first (`restartableTask` from `ember-concurrency`), not queue. Otherwise the user sees stale results from commands they already corrected.

## Source

- **Canonical implementation** — a `cue-app.gts` voice-driven photo studio with a `ContinuousDictationApp` CardDef. The prompt-build block lives around line 984; the post-generation state update around line 1170; tracked-state declarations around line 469. The full card is ~4940 lines (most of it is dictation, UI, and preset management — the steering logic is the core ~250-line slice this pattern distills). Several variants exist as exploratory rewrites; they share the same steering shape and differ in UI polish + preset surface.
- **Built on** — `integrate-openrouter-image-generation` (the single-shot primitive); `SendRequestViaProxyCommand` for the HTTP call; `restartableTask` from `ember-concurrency` for in-flight cancellation.

## See also

- [`integrate-openrouter-image-generation`](../integrate-openrouter-image-generation/README.md) — the underlying single-shot image-gen primitive. Read this first if you haven't.
- [`integrate-filedef-generated-image`](../integrate-filedef-generated-image/README.md) — persist the _final accepted_ image as an `ImageDef` once the user is satisfied with the steered output.
- [`integrate-thumbnail-card-ai`](../integrate-thumbnail-card-ai/README.md) — single-shot AI thumbnail (no steering loop). Use when one image is enough.
- [`command-typed-with-progress`](../command-typed-with-progress/README.md) — for tracking progress through long-running steering steps.
- [`command-optimistic-pipeline`](../command-optimistic-pipeline/README.md) — for a queryable run-card history of an entire steering session.
