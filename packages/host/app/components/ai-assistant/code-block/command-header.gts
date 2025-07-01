import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import ApplyButton, { type ApplyButtonState } from '../apply-button';

import CopyCodeButton from './copy-code-button';
import ViewCodeButton from './view-code-button';

export interface CodeBlockCommandHeaderSignature {
  Args: {
    action: () => void;
    actionVerb: string;
    code: string;
    commandDescription: string;
    commandState: ApplyButtonState;
    isDisplayingCode: boolean;
    toggleCode: () => void;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

const CodeBlockCommandHeader: TemplateOnlyComponent<CodeBlockCommandHeaderSignature> =
  <template>
    <header class='code-block-header'>
      <div class='command-description'>{{@commandDescription}}</div>
      <div class='actions'>
        {{#if @isDisplayingCode}}
          <CopyCodeButton @code={{@code}} />
        {{/if}}
        <ViewCodeButton
          @isDisplayingCode={{@isDisplayingCode}}
          @toggleViewCode={{@toggleCode}}
        />
        <ApplyButton
          class='command-action'
          @actionVerb={{@actionVerb}}
          @state={{@commandState}}
          {{on 'click' @action}}
          data-test-command-apply={{@commandState}}
        />
      </div>
    </header>
    <style scoped>
      .code-block-header {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--boxel-sp-xxxs);
        align-items: center;
        min-height: 3.125rem; /* 50px */
        padding: var(--boxel-sp-sm);
        background-color: var(--boxel-650);
        color: var(--boxel-light);
        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .command-description {
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        line-height: 1.5em;
        text-wrap: pretty;
      }
      .actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .command-action {
        margin-left: var(--boxel-sp-5xs);
      }
    </style>
  </template>;

export default CodeBlockCommandHeader;
