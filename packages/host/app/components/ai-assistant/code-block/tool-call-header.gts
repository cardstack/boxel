import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import { CopyButton } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import ApplyButton, { type ApplyButtonState } from '../apply-button';

import ViewCodeButton from './view-code-button';

import type { ComponentLike } from '@glint/template';

export interface CodeBlockToolCallHeaderSignature {
  Args: {
    action: () => void;
    actionVerb: string;
    code: string;
    commandDescription: string;
    toolCallState: ApplyButtonState;
    hideCodeActions?: boolean;
    icon?: ComponentLike<{ Element: Element }>;
    isDisplayingCode?: boolean;
    isCompact?: boolean;
    toggleCode?: () => void;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export default class CodeBlockToolCallHeader extends Component<CodeBlockToolCallHeaderSignature> {
  get isDisplayingCode() {
    return this.args.isDisplayingCode ?? false;
  }

  <template>
    <header class={{cn 'code-block-header' compact=@isCompact}}>
      <div class='tool-description'>
        {{#if @icon}}
          <@icon class='tool-icon' data-test-tool-header-icon />
        {{/if}}
        {{@commandDescription}}</div>
      <div class='actions'>
        {{#unless @hideCodeActions}}
          {{#if @isDisplayingCode}}
            {{#unless @isCompact}}
              <CopyButton @textToCopy={{@code}} @variant='text-only' />
            {{/unless}}
          {{/if}}
          {{#if @toggleCode}}
            <ViewCodeButton
              @isDisplayingCode={{this.isDisplayingCode}}
              @toggleViewCode={{@toggleCode}}
              @isCompact={{@isCompact}}
            />
          {{/if}}
        {{/unless}}
        <ApplyButton
          class='tool-action'
          @actionVerb={{@actionVerb}}
          @isCompact={{@isCompact}}
          @state={{@toolCallState}}
          {{on 'click' @action}}
          data-test-tool-call-apply={{@toolCallState}}
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
      .code-block-header.compact {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        min-height: auto;
        padding: 2px 0;
        background-color: transparent;
      }
      .tool-description {
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        line-height: 1.5em;
        text-wrap: pretty;
        overflow-wrap: break-word;
      }
      .tool-icon {
        display: inline-block;
        width: 1rem;
        height: 1rem;
        vertical-align: text-bottom;
        margin-right: var(--boxel-sp-5xs);
      }
      .code-block-header.compact .tool-description {
        order: 2;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0.8;
      }
      .actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .code-block-header.compact .actions {
        display: contents;
        margin-left: 0;
      }
      .tool-action {
        margin-left: var(--boxel-sp-5xs);
      }
    </style>
  </template>
}
