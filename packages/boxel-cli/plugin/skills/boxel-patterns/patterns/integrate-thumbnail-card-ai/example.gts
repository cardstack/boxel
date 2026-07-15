// Minimal example for `integrate-thumbnail-card-ai`.
//
// Structural twin of the experiments-realm/screenshot-card-demo.gts (used by
// `integrate-screenshot-card-format`), but invoking GenerateThumbnailCommand
// instead of ScreenshotCardCommand. The call signature mirrors the host's
// former `autoGenerateThumbnail` caller (retired from the host in CS-11372
// when listing commands moved to the catalog realm).
//
// Inputs the command accepts:
//   - prompt                 (required) — text prompt for the AI
//   - sourceImageUrl         (optional) — reference image (URL or data:image/...)
//   - targetRealmIdentifier  (required) — where to write the file
//   - targetPath             (optional) — subdirectory inside the realm
//   - targetCardId           (optional) — when set, the command auto-patches
//                                          cardInfo.cardThumbnail on that card
//   - cardName               (optional) — used for filename slug
//   - llmModel               (optional) — defaults to DEFAULT_IMAGE_GENERATION_LLM
//
// Output: { imageDefIdentifier } — file identifier for the generated PNG/JPG/WebP.
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import GenerateThumbnailCommand from '@cardstack/boxel-host/tools/generate-thumbnail';
import { Button } from '@cardstack/boxel-ui/components';

class Isolated extends Component<typeof ThumbnailCardAiDemo> {
  @tracked isRunning = false;
  @tracked errorMessage: string | null = null;
  @tracked imageDefIdentifier: string | null = null;

  get hasCommandContext() {
    return Boolean(this.args.context?.commandContext);
  }

  get hasPrompt() {
    return Boolean((this.args.model as any)?.prompt?.trim?.());
  }

  get isDisabled() {
    return this.isRunning || !this.hasCommandContext || !this.hasPrompt;
  }

  get targetRealmIdentifier(): string | undefined {
    let target = (this.args.model as any)?.target;
    let url = target?.[realmURL]?.href;
    if (url) return url;
    let modelRealm = (this.args.model as any)?.[realmURL]?.href;
    return modelRealm;
  }

  @action
  async generate() {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is unavailable. Open this card in host interact mode.';
      return;
    }
    let prompt = (this.args.model as any)?.prompt?.trim?.();
    if (!prompt) {
      this.errorMessage = 'Enter a prompt before generating.';
      return;
    }
    let targetRealmIdentifier = this.targetRealmIdentifier;
    if (!targetRealmIdentifier) {
      this.errorMessage =
        'Cannot determine target realm. Link a target card or save this card first.';
      return;
    }

    this.isRunning = true;
    this.errorMessage = null;
    this.imageDefIdentifier = null;

    try {
      let target = (this.args.model as any)?.target;
      let sourceImageUrl = (
        this.args.model as any
      )?.sourceImageUrl?.trim?.();

      let result = await new GenerateThumbnailCommand(commandContext).execute({
        prompt,
        sourceImageUrl: sourceImageUrl || undefined,
        targetRealmIdentifier,
        targetPath: 'Thumbnails',
        // When targetCardId is set, the command patches
        // cardInfo.cardThumbnail on that card with the new ImageDef.
        targetCardId: target?.id,
        cardName: target?.title ?? this.args.model.title,
      });

      this.imageDefIdentifier = result.imageDefIdentifier;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isRunning = false;
    }
  }

  <template>
    <article class='thumbnail-ai-demo'>
      <header>
        <h2>AI Thumbnail Generator</h2>
        <p>
          Generate a thumbnail image for the linked card. When a target is
          linked, the result auto-patches
          <code>cardInfo.cardThumbnail</code>.
        </p>
      </header>

      <section class='field'>
        <label>Target card (optional)</label>
        <@fields.target />
      </section>

      <section class='field'>
        <label>Prompt</label>
        <@fields.prompt />
      </section>

      <section class='field'>
        <label>Reference image URL (optional)</label>
        <@fields.sourceImageUrl />
      </section>

      <section class='actions'>
        <Button
          data-test-generate-thumbnail
          @disabled={{this.isDisabled}}
          {{on 'click' this.generate}}
        >
          {{if this.isRunning 'Generating…' 'Generate Thumbnail'}}
        </Button>
      </section>

      {{#if this.imageDefIdentifier}}
        <section class='result'>
          <p>Saved to:</p>
          <code class='url'>{{this.imageDefIdentifier}}</code>
          <img src={{this.imageDefIdentifier}} alt='Generated thumbnail' />
        </section>
      {{/if}}

      {{#if this.errorMessage}}
        <p class='status status--error'>{{this.errorMessage}}</p>
      {{/if}}
    </article>

    <style scoped>
      .thumbnail-ai-demo {
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
      .actions {
        display: flex;
        gap: var(--boxel-sp);
      }
      .result {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--boxel-50);
      }
      .result img {
        max-width: 100%;
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }
      .url {
        word-break: break-all;
        font-size: var(--boxel-font-sm);
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

export class ThumbnailCardAiDemo extends CardDef {
  static displayName = 'AI Thumbnail Generator';

  @field target = linksTo(CardDef);
  @field prompt = contains(TextAreaField);
  @field sourceImageUrl = contains(StringField);

  static isolated = Isolated;
}
