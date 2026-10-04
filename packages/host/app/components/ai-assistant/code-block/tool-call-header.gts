import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import { BoxelButton, CopyButton } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import ApplyButton, { type ApplyButtonState } from '../apply-button';

import ViewCodeButton from './view-code-button';

export interface CodeBlockToolCallHeaderSignature {
  Args: {
    action: () => void;
    actionVerb: string;
    code: string;
    commandDescription: string;
    toolCallState: ApplyButtonState;
    hideCodeActions?: boolean;
    isDisplayingCode?: boolean;
    isCompact?: boolean;
    toggleCode?: () => void;
    // A second choice offered beside the action while the call is ready,
    // e.g. Decline next to Approve.
    secondaryAction?: () => void;
    secondaryActionVerb?: string;
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
      <div class='tool-description'>{{@commandDescription}}</div>
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
        {{#if @secondaryAction}}
          {{#if (eq @toolCallState 'ready')}}
            <BoxelButton
              @kind='secondary'
              @size='auto'
              class='secondary-action'
              {{on 'click' @secondaryAction}}
              data-test-tool-call-secondary-action={{@secondaryActionVerb}}
            >
              {{@secondaryActionVerb}}
            </BoxelButton>
          {{/if}}
        {{/if}}
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
      /* Sized like the apply button it sits beside, outlined in light so
        it reads on the dark header. The header class outranks the button
        kind's own colors. */
      .code-block-header .secondary-action {
        --boxel-button-color: transparent;
        --boxel-button-text-color: var(--boxel-light);
        --boxel-button-border: 1px solid var(--boxel-light);
        --boxel-button-font: 600 var(--boxel-font-xs);
        padding: 3px 10px;
        min-width: inherit;
        min-height: inherit;
        height: 1.5rem;
        border-radius: 100px;
        margin-left: var(--boxel-sp-5xs);
      }
    </style>
  </template>
}
