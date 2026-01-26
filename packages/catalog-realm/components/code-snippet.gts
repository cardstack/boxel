import GlimmerComponent from '@glimmer/component';
import { CopyButton } from '@cardstack/boxel-ui/components';

export interface CodeSnippetSignature {
  Args: {
    code: string;
  };
  Element: HTMLElement;
  Blocks: {};
}

export default class CodeSnippet extends GlimmerComponent<CodeSnippetSignature> {
  <template>
    <div class='code-snippet-container'>
      <header class='code-snippet-header'>
        <span class='code-snippet-title'>CODE</span>
        <CopyButton
          class='code-snippet-copy-button'
          @textToCopy={{@code}}
        />
      </header>
      <pre class='code-snippet' data-test-code-snippet>{{@code}}</pre>
    </div>
    <style scoped>
      .code-snippet-container {
        --field-header-bg: var(--boxel-200);
        --field-bg: var(--card, var(--boxel-100));
        --field-fg: var(--card-foreground, var(--boxel-dark));
        --field-border: var(
          --border,
          color-mix(in oklab, var(--field-fg) 20%, var(--field-bg))
        );
        display: flex;
        flex-direction: column;
      }
      .code-snippet-copy-button {
        margin-left: auto;
      }
      .code-snippet-header {
        border: 1px solid var(--field-border);
        border-bottom: none;
        border-top-left-radius: var(--radius, var(--boxel-border-radius));
        border-top-right-radius: var(--radius, var(--boxel-border-radius));
        background-color: var( --field-header-bg);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
      }
      .code-snippet-title {
        font-size: var(--boxel-font-size-xs);
        letter-spacing: 0.08em;
        font-weight: 600;
      }
      .code-snippet {
        margin-block: 0;
        padding: var(--boxel-sp);
        background-color: var(--field-bg);
        border: 1px solid var(--field-border);
        border-top: none;
        border-bottom-left-radius: var(--radius, var(--boxel-border-radius));
        border-bottom-right-radius: var(--radius, var(--boxel-border-radius));
        border-top-left-radius: 0;
        border-top-right-radius: 0;
        color: var(--field-fg);
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: var(--boxel-font-size-xs);
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </template>
}
