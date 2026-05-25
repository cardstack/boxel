import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import ScreenshotCardCommand from '@cardstack/boxel-host/commands/screenshot-card';
import { Button } from '@cardstack/boxel-ui/components';

type ScreenshotFormat = 'isolated' | 'embedded';

// Built-in enum field — atom view shows the current value as plain text;
// edit view renders a BoxelSelect dropdown of the configured options.
const FormatField = enumField(StringField, {
  options: ['isolated', 'embedded'],
  displayName: 'Screenshot Format',
});

class Isolated extends Component<typeof ScreenshotCardDemo> {
  @tracked isRunning = false;
  @tracked errorMessage: string | null = null;
  @tracked imageDefUrl: string | null = null;

  get hasCommandContext() {
    return Boolean(this.args.context?.commandContext);
  }

  get hasLinkedCard() {
    return Boolean((this.args.model as any)?.card?.id);
  }

  get isDisabled() {
    return this.isRunning || !this.hasCommandContext || !this.hasLinkedCard;
  }

  get effectiveFormat(): ScreenshotFormat {
    let raw = (this.args.model as any)?.format?.trim?.();
    return raw === 'embedded' ? 'embedded' : 'isolated';
  }

  @action
  async takeScreenshot() {
    let commandContext = this.args.context?.commandContext;
    let card = (this.args.model as any)?.card;
    if (!commandContext) {
      this.errorMessage =
        'Command context is unavailable. Open this card in host interact mode.';
      return;
    }
    if (!card) {
      this.errorMessage = 'Link a card before taking a screenshot.';
      return;
    }

    this.isRunning = true;
    this.errorMessage = null;
    this.imageDefUrl = null;
    try {
      let result = await new ScreenshotCardCommand(commandContext).execute({
        card,
        format: this.effectiveFormat,
      });
      this.imageDefUrl = result.imageDefUrl;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isRunning = false;
    }
  }

  <template>
    <article class='screenshot-card-demo'>
      <header>
        <h2>Screenshot Card Demo</h2>
        <p>
          Pick a card and a format, then capture a settled PNG into the
          card's own realm under
          <code>Screenshots/</code>.
        </p>
      </header>

      <section class='field'>
        <label>Card to screenshot</label>
        <@fields.card />
      </section>

      <section class='field'>
        <label>Format</label>
        <@fields.format />
      </section>

      <section class='actions'>
        <Button
          data-test-take-screenshot
          @disabled={{this.isDisabled}}
          {{on 'click' this.takeScreenshot}}
        >
          {{if this.isRunning 'Taking screenshot…' 'Take Screenshot'}}
        </Button>
      </section>

      {{#if this.imageDefUrl}}
        <section class='result'>
          <p>Saved to:</p>
          <code class='url'>{{this.imageDefUrl}}</code>
          <img src={{this.imageDefUrl}} alt='Card screenshot' />
        </section>
      {{/if}}

      {{#if this.errorMessage}}
        <p class='status status--error'>{{this.errorMessage}}</p>
      {{/if}}
    </article>

    <style scoped>
      .screenshot-card-demo {
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

export class ScreenshotCardDemo extends CardDef {
  static displayName = 'Screenshot Card Demo';

  @field card = linksTo(CardDef);
  @field format = contains(FormatField);

  static isolated = Isolated;
}
