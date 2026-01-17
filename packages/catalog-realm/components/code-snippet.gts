import GlimmerComponent from '@glimmer/component';
import { CopyButton } from '@cardstack/boxel-ui/components';

interface CodeSnippetSignature {
  Args: {
    code: string;
    label?: string;
  };
  Element: HTMLDivElement;
}

export default class CodeSnippet extends GlimmerComponent<CodeSnippetSignature> {
  get label() {
    return this.args.label ?? 'Code';
  }

  <template>
    <div class='code-snippet-container' ...attributes>
      <div class='code-snippet-header'>
        <span class='code-snippet-label'>{{this.label}}</span>
        <CopyButton
          @textToCopy={{@code}}
          @tooltipText='Copy code'
          @ariaLabel='Copy code'
        />
      </div>
      <pre class='code-snippet'><code>{{@code}}</code></pre>
    </div>
    <style scoped>
      .code-snippet-container {
        --field-bg: var(--card, var(--boxel-100));
        --field-fg: var(--card-foreground, var(--boxel-dark));
        --field-border: var(
          --border,
          color-mix(in oklab, var(--field-fg) 20%, var(--field-bg))
        );
        --header-bg: var(--muted, var(--boxel-100));
        --header-fg: var(--muted-foreground, var(--boxel-600));
        margin: var(--boxel-sp) 0 0 0;
      }
      .code-snippet-header {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
        background-color: var(--header-bg);
        border: 1px solid var(--field-border);
        border-bottom: none;
        border-radius: var(--radius, var(--boxel-border-radius))
          var(--radius, var(--boxel-border-radius)) 0 0;
      }
      .code-snippet-label {
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        color: var(--header-fg);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .code-snippet {
        margin: 0;
        padding: var(--boxel-sp);
        background-color: var(--field-bg);
        border: 1px solid var(--field-border);
        border-radius: 0 0 var(--radius, var(--boxel-border-radius))
          var(--radius, var(--boxel-border-radius));
        color: var(--field-fg);
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-caption-line-height);
        overflow-x: auto;
        white-space: pre-wrap;
      }
      .code-snippet code {
        display: block;
        white-space: pre;
      }
    </style>
  </template>
}
