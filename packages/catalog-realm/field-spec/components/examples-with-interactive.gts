import GlimmerComponent from '@glimmer/component';
import LayoutList from '@cardstack/boxel-icons/layout-list';
import { provide } from 'ember-provide-consume-context';
import {
  PermissionsContextName,
  type Permissions,
} from '@cardstack/runtime-common';

export interface ExamplesWithInteractiveSignature {
  Args: {};
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

export default class ExamplesWithInteractive extends GlimmerComponent<ExamplesWithInteractiveSignature> {
  @provide(PermissionsContextName)
  get permissions(): Permissions | undefined {
    return { canWrite: true, canRead: true };
  }

  <template>
    <section class='examples-with-interactive-preview section'>
      <header
        class='row-header'
        aria-labelledby='examples-with-interactive-preview'
      >
        <div class='row-header-left'>
          <LayoutList width='20' height='20' role='presentation' />
          <h2 id='examples-with-interactive-preview'>Field Usage Examples</h2>
        </div>
      </header>
      <div class='examples-with-interactive-grid'>
        {{yield}}
      </div>
    </section>
    <style scoped>
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .examples-with-interactive-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .examples-with-interactive-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--boxel-sp);
      }
      .examples-with-interactive-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
