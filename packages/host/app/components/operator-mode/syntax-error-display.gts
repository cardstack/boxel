import Component from '@glimmer/component';

import { CopyButton } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLElement;
  Args: {
    syntaxErrors: string;
  };
}

export default class SyntaxErrorDisplay extends Component<Signature> {
  removeSourceMappingURL(syntaxErrors: string): string {
    return syntaxErrors.replace(/\/\/# sourceMappingURL=.*/g, '');
  }
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
        overflow: hidden;
        text-wrap: auto;
      }
    </style>

    <div class='syntax-error-container' data-test-syntax-error>
      <div class='syntax-error-box'>
        <div class='syntax-error-header'>
          <div class='syntax-error-text'>
            Syntax Error
          </div>
          <CopyButton
            @textToCopy={{this.removeSourceMappingURL @syntaxErrors}}
          />
        </div>

        <hr />
        <pre data-test-syntax-errors>{{this.removeSourceMappingURL
            @syntaxErrors
          }}</pre>
      </div>
    </div>
  </template>
}
