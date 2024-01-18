import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { IconButton } from '@cardstack/boxel-ui/components';
import { element, cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

export interface PillSignature {
  Args: {
    inert?: boolean;
    removeAction?: () => void;
  };
  Blocks: {
    default: [];
    icon: [];
  };
  Element: HTMLButtonElement | HTMLDivElement;
}

export default class Pill extends Component<PillSignature> {
  <template>
    {{#let (element (if @inert 'div' 'button')) as |Tag|}}
      <Tag class={{cn 'pill' inert='inert'}} ...attributes>
        <figure class='icon'>
          {{yield to='icon'}}
        </figure>
        <span>
          {{yield}}
        </span>

        {{#if @inert}}
          {{#if @removeAction}}
            <IconButton
              class='remove-button'
              @icon={{IconX}}
              {{on 'click' @removeAction}}
              data-test-remove-card-btn
            />
          {{/if}}
        {{/if}}
      </Tag>
    {{/let}}

    <style>
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-sm);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .inert {
        border: 0;
        background-color: var(--boxel-100);
        color: inherit;
      }

      .pill:not(.inert):hover {
        background-color: var(--boxel-100);
      }

      .icon {
        display: flex;
        margin-block: 0;
        margin-inline: 0;
      }

      .icon > :deep(*) {
        height: 20px;
      }

      .remove-button {
        --boxel-icon-button-width: 25px;
        --boxel-icon-button-height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .remove-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
    </style>
  </template>
}
