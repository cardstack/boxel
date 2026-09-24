import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import enumField from '@cardstack/base/enum';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import CaptureCardTool from '@cardstack/boxel-host/tools/capture-card';
import { Button } from '@cardstack/boxel-ui/components';

type OnDemandCaptureFormat = 'isolated' | 'embedded';

// Built-in enum field — atom view shows the current value as plain text;
// edit view renders a BoxelSelect dropdown of the configured options.
const FormatField = enumField(StringField, {
  options: ['isolated', 'embedded'],
  displayName: 'Capture Format',
});

class Isolated extends Component<typeof CaptureCardDemo> {
  @tracked isRunning = false;
  @tracked errorMessage: string | null = null;
  @tracked captureUrl: string | null = null;

  get hasToolContext() {
    return Boolean(this.args.context?.toolContext);
  }

  get hasLinkedCard() {
    return Boolean((this.args.model as any)?.card?.id);
  }

  get isDisabled() {
    return this.isRunning || !this.hasToolContext || !this.hasLinkedCard;
  }

  get effectiveFormat(): OnDemandCaptureFormat {
    let raw = (this.args.model as any)?.format?.trim?.();
    return raw === 'embedded' ? 'embedded' : 'isolated';
  }

  @action
  async takeCapture() {
    let toolContext = this.args.context?.toolContext;
    let card = (this.args.model as any)?.card;
    if (!toolContext) {
      this.errorMessage =
        'Command context is unavailable. Open this card in host interact mode.';
      return;
    }
    if (!card) {
      this.errorMessage = 'Link a card before taking a capture.';
      return;
    }

    this.isRunning = true;
    this.errorMessage = null;
    this.captureUrl = null;
    try {
      let result = await new CaptureCardTool(toolContext).execute({
        card,
        format: this.effectiveFormat,
      });
      this.captureUrl = result.captures?.[0]?.url ?? null;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isRunning = false;
    }
  }

  <template>
    <article class='capture-card-demo'>
      <header>
        <h2>Capture Card Demo</h2>
        <p>
          Pick a card and a format, then capture a settled PNG. The result
          is a durable served URL from the media cache.
        </p>
      </header>

      <section class='field'>
        <label>Card to capture</label>
        <@fields.card />
      </section>

      <section class='field'>
        <label>Format</label>
        <@fields.format />
      </section>

      <section class='actions'>
        <Button
          data-test-take-capture
          @disabled={{this.isDisabled}}
          {{on 'click' this.takeCapture}}
        >
          {{if this.isRunning 'Taking capture…' 'Take Capture'}}
        </Button>
      </section>

      {{#if this.captureUrl}}
        <section class='result'>
          <p>Served at:</p>
          <code class='url'>{{this.captureUrl}}</code>
          <img src={{this.captureUrl}} alt='Card capture' />
        </section>
      {{/if}}

      {{#if this.errorMessage}}
        <p class='status status--error'>{{this.errorMessage}}</p>
      {{/if}}
    </article>

    <style scoped>
      .capture-card-demo {
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
        background-color: var(--boxel-50);
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

export class CaptureCardDemo extends CardDef {
  static displayName = 'Capture Card Demo';

  @field card = linksTo(CardDef);
  @field format = contains(FormatField);

  static isolated = Isolated;
}
