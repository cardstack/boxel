import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { IconButton, Tooltip } from '@cardstack/boxel-ui/components';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLElement;
  Args: {
    syntaxErrors: string;
  };
}

export default class SyntaxErrorDisplay extends Component<Signature> {
  @tracked recentlyCopied = false;

  removeSourceMappingURL(syntaxErrors: string): string {
    return syntaxErrors.replace(/\/\/# sourceMappingURL=.*/g, '');
  }

  private copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(
      this.removeSourceMappingURL(this.args.syntaxErrors),
    );
    this.recentlyCopied = true;

    setTimeout(() => (this.recentlyCopied = false), 2000);
  });

  <template>
    <style scoped>
      .syntax-error-container {
        background: var(--boxel-100);
        padding: var(--boxel-sp);
        border-radius: var(--boxel-radius);
        height: 100%;
      }

      .syntax-error-box {
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        background: var(--boxel-200);
      }

      .syntax-error-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .syntax-error-text {
        color: red;
        font-weight: 600;
      }

      hr {
        width: calc(100% + var(--boxel-sp) * 2);
        margin-left: calc(var(--boxel-sp) * -1);
        margin-top: calc(var(--boxel-sp-sm) + 1px);
      }

      pre {
        overflow: auto;
      }
    </style>

    <div class='syntax-error-container' data-test-syntax-error>
      <div class='syntax-error-box'>
        <div class='syntax-error-header'>
          <div class='syntax-error-text'>
            Syntax Error
          </div>
          <Tooltip @placement='top' class='editability-icon'>
            <:trigger>
              <IconButton
                @icon={{CopyIcon}}
                @width='18px'
                @height='18px'
                class='copy-syntax-error'
                {{on 'click' (perform this.copyToClipboard)}}
                aria-label='Copy'
                data-test-copy-syntax-error
              />
            </:trigger>
            <:content>
              {{if this.recentlyCopied 'Copied!' 'Copy to clipboard'}}
            </:content>
          </Tooltip>

        </div>

        <hr />
        <pre data-test-syntax-errors>{{this.removeSourceMappingURL
            @syntaxErrors
          }}</pre>
      </div>
    </div>
  </template>
}
