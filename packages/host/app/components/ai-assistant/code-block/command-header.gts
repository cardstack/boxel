import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import { CopyButton } from '@cardstack/boxel-ui/components';

import ApplyButton, { type ApplyButtonState } from '../apply-button';

import ViewCodeButton from './view-code-button';

export interface CodeBlockCommandHeaderSignature {
  Args: {
    action: () => void;
    actionVerb: string;
    code: string;
    commandDescription: string;
    commandState: ApplyButtonState;
    hideCodeActions?: boolean;
    isDisplayingCode?: boolean;
    toggleCode?: () => void;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export default class CodeBlockCommandHeader extends Component<CodeBlockCommandHeaderSignature> {
  get isDisplayingCode() {
    return this.args.isDisplayingCode ?? false;
  }

  <template>
    <header class='code-block-header'>
      <div class='command-description'>{{@commandDescription}}</div>
      <div class='actions'>
        {{#unless @hideCodeActions}}
          {{#if @isDisplayingCode}}
            <CopyButton @textToCopy={{@code}} @variant='text-only' />
          {{/if}}
          {{#if @toggleCode}}
            <ViewCodeButton
              @isDisplayingCode={{this.isDisplayingCode}}
              @toggleViewCode={{@toggleCode}}
            />
          {{/if}}
        {{/unless}}
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
        grid-template-columns: minmax(0, 1fr) max-content;
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
        overflow-wrap: break-word;
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
  </template>
}
