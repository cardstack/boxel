// Distilled steering-loop card. The full real-world implementation is a
// `cue-app.gts` voice-driven photo studio with a `ContinuousDictationApp`
// CardDef — ~4940 lines including voice dictation, preset UI, filmstrip,
// etc. This example pulls out just the steering essentials so the shape
// reads in one bite.
//
// Pattern: build a steerable image generator using
//   1. an immutable seed prompt (subject anchor)
//   2. an evolving steering input (the user's latest command)
//   3. a grounding image (first stable output, identity anchor)
//   4. a modification-target image (latest output, what to change)
//   5. an explicit role-narration prompt that ranks the user input as
//      priority-1 and tells the model what each attached image is for
//
// See the README for the layered prompt template + post-generation state
// update + the gotchas list.
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import SendRequestViaProxyCommand from '@cardstack/boxel-host/tools/send-request-via-proxy';
import { Button } from '@cardstack/boxel-ui/components';
import CameraIcon from '@cardstack/boxel-icons/camera';

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';
const HISTORY_LIMIT = 4;

class Isolated extends Component<typeof SteeredImageDemo> {
  // ─── Chain state (in-memory; persist on accept via ImageDef) ────────
  @tracked firstImage: string | null = null; // grounding reference
  @tracked currentImage: string | null = null; // modification target
  @tracked previousImage: string | null = null; // for filmstrip "before"
  @tracked imageHistory: Array<{
    image: string;
    version: string;
    timestamp: Date;
  }> = [];

  @tracked isGenerating = false;
  @tracked errorMessage: string | null = null;
  @tracked steeringInput = ''; // the user's current command

  get hasCommandContext() {
    return Boolean(this.args.context?.commandContext);
  }

  get hasSeed() {
    return Boolean((this.args.model as any)?.subjectPrompt?.trim?.());
  }

  get canSteer() {
    return (
      !this.isGenerating &&
      this.hasCommandContext &&
      this.hasSeed &&
      this.steeringInput.trim().length > 0
    );
  }

  get generationNum(): number {
    let raw = this.args.model.generationCount;
    return raw ? parseInt(raw, 10) || 0 : 0;
  }

  // ─── Layered prompt — the heart of the steering pattern ─────────────
  buildPrompt(args: {
    subjectPrompt: string;
    userInput: string;
    generationNum: number;
    hasFirstImage: boolean;
    hasCurrentImage: boolean;
  }): string {
    let {
      subjectPrompt,
      userInput,
      generationNum,
      hasFirstImage,
      hasCurrentImage,
    } = args;

    let firstImageLine = hasFirstImage
      ? '• FIRST IMAGE (attached): baseline / grounding reference. Maintain the core subject and composition established here.'
      : '';
    let lastImageLine = hasCurrentImage
      ? "• LAST IMAGE (attached): what to modify. Apply the user's request to this most recent version."
      : '';
    let firstGenLine =
      !hasFirstImage && !hasCurrentImage
        ? '• FIRST GENERATION: Create initial image based on the original subject description and user request.'
        : '';

    return `Generate image variation #${generationNum}:

ORIGINAL SUBJECT DESCRIPTION (BASE): "${subjectPrompt}"
CURRENT EVOLVED SUBJECT: "${subjectPrompt}"

PRIMARY USER MODIFICATION REQUEST: "${userInput}"
** PRIORITY: The user's command takes precedence over all preset parameters below. **

IMAGE CONTEXT GUIDANCE:
${firstImageLine}
${lastImageLine}
${firstGenLine}

EXECUTION INSTRUCTIONS:
1. PRIORITIZE USER REQUEST: "${userInput}" overrides any conflicting parameters.
2. Keep the original subject essence: "${subjectPrompt}"
3. ${hasFirstImage ? 'Use the first image to understand intended style, composition, and subject positioning.' : 'Establish the baseline style and composition.'}
4. ${hasCurrentImage ? 'Apply the user modification to the last image while maintaining consistency with the first image.' : 'Apply the user request to create the scene.'}
5. User commands can modify: lighting, composition, mood, camera angle, focal length, depth of field, color grading, or any visual aspect.
6. Maintain visual continuity across the sequence unless explicitly directed otherwise.

Create a high-quality image following these guidelines, with user commands taking priority.`;
  }

  // ─── The steering action — restartable so a new input cancels the
  //     prior in-flight gen rather than queueing.
  steer = restartableTask(async (userInput: string) => {
    if (!this.hasCommandContext) return;
    let subjectPrompt = (this.args.model as any)?.subjectPrompt?.trim?.();
    if (!subjectPrompt) {
      this.errorMessage = 'Enter a base subject before steering.';
      return;
    }

    this.isGenerating = true;
    this.errorMessage = null;

    try {
      let generationNum = this.generationNum + 1;
      let firstImageB64 = this.firstImage;
      let currentImageB64 = this.currentImage;

      let prompt = this.buildPrompt({
        subjectPrompt,
        userInput,
        generationNum,
        hasFirstImage: Boolean(firstImageB64),
        hasCurrentImage: Boolean(currentImageB64),
      });

      let messages: any[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ];
      // Attach first image (grounding) if available.
      if (firstImageB64) {
        messages[0].content.push({
          type: 'image_url',
          image_url: { url: firstImageB64 },
        });
      }
      // Attach current/last image (modification target), only if different
      // from first — the model treats duplicates as a single image.
      if (currentImageB64 && currentImageB64 !== firstImageB64) {
        messages[0].content.push({
          type: 'image_url',
          image_url: { url: currentImageB64 },
        });
      }

      let result = await new SendRequestViaProxyCommand(
        this.args.context!.commandContext,
      ).execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: DEFAULT_MODEL,
          messages,
        }),
      });

      if (!result.response.ok) {
        throw new Error(
          `Image generation failed: ${result.response.statusText}`,
        );
      }

      let responseData = await result.response.json();
      let messageContent = responseData.choices?.[0]?.message;
      let dataUrl: string | undefined = messageContent?.images
        ?.map((img: any) => img.image_url?.url)
        .find((url: string) => url && url.startsWith('data:image/'));

      if (!dataUrl) {
        throw new Error(
          messageContent?.content || 'No image was generated.',
        );
      }

      // ─── Post-generation state update ─────────────────────────────
      // 1. Push current into history (dedup, bounded).
      if (this.currentImage) {
        let isDuplicate = this.imageHistory.some(
          (item) => item.image === this.currentImage,
        );
        if (!isDuplicate) {
          this.imageHistory = [
            ...this.imageHistory.slice(-HISTORY_LIMIT),
            {
              image: this.currentImage,
              version: String(generationNum - 1),
              timestamp: new Date(),
            },
          ];
        }
      }
      // 2. Snapshot previous, advance current.
      this.previousImage = this.currentImage;
      this.currentImage = dataUrl;
      // 3. Pin firstImage early in the chain (gen #1 or #2).
      if (!this.firstImage && generationNum <= 2) {
        this.firstImage = dataUrl;
      }
      // 4. Bump count + clear the steering input ready for the next command.
      this.args.model.generationCount = String(generationNum);
      this.steeringInput = '';
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isGenerating = false;
    }
  });

  // ─── Reset path — keep the seed, clear chain state ──────────────────
  @action
  reset() {
    this.currentImage = null;
    this.previousImage = null;
    this.firstImage = null;
    this.imageHistory = [];
    this.args.model.generationCount = '0';
  }

  @action
  onSteeringInput(event: Event) {
    this.steeringInput = (event.target as HTMLInputElement).value;
  }

  @action
  onSteerClick() {
    if (this.canSteer) {
      this.steer.perform(this.steeringInput.trim());
    }
  }

  <template>
    <article class='steering-demo'>
      <header>
        <h2>Steered Image Generator</h2>
        <p>
          Set a base subject, then iteratively steer the generation with short
          commands. Each step keeps the original subject's identity while
          applying the latest direction.
        </p>
      </header>

      <section class='field'>
        <label>Base subject (immutable anchor)</label>
        <@fields.subjectPrompt />
      </section>

      <section class='field'>
        <label>Steering command</label>
        <input
          type='text'
          placeholder='e.g. warmer light, tighter crop, side angle…'
          value={{this.steeringInput}}
          {{on 'input' this.onSteeringInput}}
        />
      </section>

      <section class='actions'>
        <Button
          data-test-steer
          @disabled={{not this.canSteer}}
          {{on 'click' this.onSteerClick}}
        >
          <CameraIcon />
          {{if this.isGenerating 'Generating…' 'Steer'}}
        </Button>
        <Button @kind='secondary' {{on 'click' this.reset}}>
          Reset chain
        </Button>
      </section>

      {{#if this.errorMessage}}
        <p class='status status--error'>{{this.errorMessage}}</p>
      {{/if}}

      <section class='lineage'>
        {{#if this.firstImage}}
          <figure class='frame'>
            <img src={{this.firstImage}} alt='Grounding reference' />
            <figcaption>First (grounding)</figcaption>
          </figure>
        {{/if}}
        {{#each this.imageHistory as |entry|}}
          <figure class='frame frame--history'>
            <img src={{entry.image}} alt='Step' />
            <figcaption>#{{entry.version}}</figcaption>
          </figure>
        {{/each}}
        {{#if this.currentImage}}
          <figure class='frame frame--current'>
            <img src={{this.currentImage}} alt='Current' />
            <figcaption>Current (#{{this.generationNum}})</figcaption>
          </figure>
        {{/if}}
      </section>
    </article>

    <style scoped>
      .steering-demo {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
      }
      header p {
        margin: var(--boxel-sp-xs) 0 0;
        color: var(--boxel-700);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .field label {
        font-weight: 600;
      }
      .field input[type='text'] {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }
      .actions {
        display: flex;
        gap: var(--boxel-sp);
      }
      .lineage {
        display: flex;
        gap: var(--boxel-sp);
        overflow-x: auto;
        padding-bottom: var(--boxel-sp-xs);
      }
      .frame {
        margin: 0;
        flex-shrink: 0;
      }
      .frame img {
        width: 160px;
        height: 160px;
        object-fit: cover;
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }
      .frame--current img {
        border-color: var(--primary, var(--boxel-purple-300));
        border-width: 2px;
      }
      .frame figcaption {
        margin-top: var(--boxel-sp-xs);
        font-size: var(--boxel-font-sm);
        color: var(--boxel-600);
      }
      .status {
        margin: 0;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
      }
      .status--error {
        background: color-mix(in srgb, var(--boxel-error-100) 12%, white);
        color: var(--boxel-error-100);
      }
    </style>
  </template>
}

export class SteeredImageDemo extends CardDef {
  static displayName = 'Steered Image Generator';

  @field subjectPrompt = contains(TextAreaField);
  @field generationCount = contains(StringField);

  static isolated = Isolated;
}
