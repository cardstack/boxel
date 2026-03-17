import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import {
  BoxelButton,
  IconButton,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import AlertCircle from '@cardstack/boxel-icons/alert-circle';
import CircleCheck from '@cardstack/boxel-icons/circle-check';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    isVisible: boolean;
    onDismiss: () => void;
    status?: 'loading' | 'success' | 'error';
    ctaLabel?: string;
    onCtaClick?: () => void;
  };
  Blocks: {
    header: [];
    default: [];
  };
}

export default class Toast extends Component<Signature> {
  <template>
    <div
      class='toast {{if @isVisible "visible"}}'
      data-test-toast={{@isVisible}}
      ...attributes
    >
      <header class='toast-header'>
        {{#if (has-block 'header')}}
          {{yield to='header'}}
        {{/if}}
        <IconButton
          @icon={{IconX}}
          @width='10'
          @height='10'
          {{on 'click' @onDismiss}}
          class='toast-close-button'
          aria-label='close toast'
          tabindex={{unless @isVisible '-1'}}
          data-test-close-toast
        />
      </header>
      <div class='toast-content' data-test-toast-content>
        {{#if @status}}
          <span class='toast-status-icon'>
            {{#if (eq @status 'loading')}}
              <LoadingIndicator @color='var(--boxel-light)' />
            {{else if (eq @status 'success')}}
              <CircleCheck width='16' height='16' />
            {{else if (eq @status 'error')}}
              <AlertCircle width='16' height='16' />
            {{/if}}
          </span>
        {{/if}}
        {{yield}}
      </div>
      {{#if @ctaLabel}}
        <BoxelButton
          @kind='secondary-dark'
          @size='extra-small'
          class='toast-cta-button'
          {{on 'click' @onCtaClick}}
          tabindex={{unless @isVisible '-1'}}
          data-test-toast-cta-button
        >
          {{@ctaLabel}}
        </BoxelButton>
      {{/if}}
    </div>
    <style scoped>
      .toast {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        background-color: var(--boxel-ai-purple);
        border-radius: var(--boxel-border-radius);
        padding: 0;
        overflow: hidden;
        position: absolute;
        bottom: calc(
          var(--boxel-sp) + var(--container-button-size) + var(--boxel-sp)
        );
        right: var(--boxel-sp);
        opacity: 0;
        height: 0;
        max-width: 250px;
        transition:
          transform 0.5s ease-in-out,
          opacity 0.5s ease-in-out;
        transform: translateY(100%);
      }
      .visible {
        padding: var(--boxel-sp);
        opacity: 1;
        height: fit-content;
        transform: translateY(0);
      }
      .toast-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        position: relative;
        justify-content: flex-end;
      }
      .toast-close-button {
        --icon-color: var(--boxel-450);
        border: none;
        background: none;
        padding: 1px;
        border-radius: var(--boxel-border-radius-xs);
        transition: background-color 0.2s ease;
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
      }
      .toast-close-button:hover {
        --icon-color: var(--boxel-light);
        background-color: rgba(255, 255, 255, 0.1);
      }
      .toast-cta-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-min-height: 1.5rem;
        --boxel-button-padding: 0 var(--boxel-sp-xs);
        min-width: initial;
        width: fit-content;
        max-height: 1.5rem;
        margin-left: auto;
      }
      .toast-cta-button:hover {
        filter: brightness(1.1);
      }
      .toast-content {
        color: var(--boxel-light);
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        line-height: 1.25rem;
        letter-spacing: var(--boxel-lsp-xs);
        overflow: hidden;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
      }
      .toast-status-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        --icon-color: var(--boxel-light);
      }
    </style>
  </template>
}
