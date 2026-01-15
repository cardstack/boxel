import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import CopyIcon from '@cardstack/boxel-icons/copy';
import CopyCheckIcon from '@cardstack/boxel-icons/copy-check';

interface CodeSnippetSignature {
  Args: {
    code: string;
    label?: string;
  };
  Element: HTMLDivElement;
}

export default class CodeSnippet extends GlimmerComponent<CodeSnippetSignature> {
  @tracked private isCopied = false;
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  get label() {
    return this.args.label ?? 'Code';
  }

  @action
  async copyCode() {
    try {
      await navigator.clipboard.writeText(this.args.code);

      // Clear any existing timeout
      if (this.copyTimeout) {
        clearTimeout(this.copyTimeout);
      }

      this.isCopied = true;

      this.copyTimeout = setTimeout(() => {
        this.isCopied = false;
        this.copyTimeout = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
    }
  }

  <template>
    <div class='code-snippet-container' ...attributes>
      <div class='code-snippet-header'>
        <span class='code-snippet-label'>{{this.label}}</span>
        <button
          type='button'
          class='copy-button'
          title='Copy code'
          {{on 'click' this.copyCode}}
        >
          {{#if this.isCopied}}
            <CopyCheckIcon width='14' height='14' />
            <span>Copied</span>
          {{else}}
            <CopyIcon width='14' height='14' />
            <span>Copy</span>
          {{/if}}
        </button>
      </div>
      <pre class='code-snippet'><code>{{@code}}</code></pre>
    </div>
    <style scoped>
      .code-snippet-container {
        margin: calc(var(--spacing, 0.25rem) * 2) 0 0 0;
      }
      .code-snippet-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: calc(var(--spacing, 0.25rem) * 1)
          calc(var(--spacing, 0.25rem) * 2);
        background-color: var(--muted, #f1f5f9);
        border: 1px solid var(--border, #e0e0e0);
        border-bottom: none;
        border-radius: var(--radius, 0.375rem) var(--radius, 0.375rem) 0 0;
      }
      .code-snippet-label {
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .code-snippet {
        margin: 0;
        padding: calc(var(--spacing, 0.25rem) * 2);
        background-color: var(--card, #000000);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 0 0 var(--radius, 0.375rem) var(--radius, 0.375rem);
        font-family: var(
          --font-mono,
          'Monaco',
          'Menlo',
          'Ubuntu Mono',
          'Consolas',
          monospace
        );
        font-size: 0.75rem;
        line-height: 1.5;
        overflow-x: auto;
        color: var(--foreground, #ffffff);
      }
      .code-snippet code {
        display: block;
        white-space: pre;
      }
      .copy-button {
        padding: calc(var(--spacing, 0.25rem) * 1)
          calc(var(--spacing, 0.25rem) * 2);
        background-color: transparent;
        border: none;
        border-radius: var(--radius, 0.375rem);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 1);
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 0.75rem;
        color: var(--muted-foreground, #64748b);
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }
      .copy-button:hover {
        background-color: var(--accent, #f0f9ff);
        color: var(--accent-foreground, #0f172a);
      }
      .copy-button:focus {
        outline: 2px solid var(--ring, #3b82f6);
        outline-offset: 2px;
      }
    </style>
  </template>
}
