import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import setBodyClass from 'ember-set-body-class/helpers/set-body-class';

import cssVar from '../../helpers/css-var.ts';
import { bool, eq } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    backgroundImageURL?: string;
    boxelModalOverlayColor?: string;
    centered?: boolean;
    imgURL?: string;
    isOpen?: boolean;
    isOverlayDismissalDisabled?: boolean;
    layer?: 'urgent';
    onClose: () => void;
    size?: 'x-small' | 'small' | 'medium' | 'large' | 'full-screen';
    zIndex?: number;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDialogElement;
}

export default class Modal extends Component<Signature> {
  get backgroundImageURL() {
    return this.args.backgroundImageURL
      ? `url(${this.args.backgroundImageURL})`
      : '';
  }

  <template>
    {{#if @isOpen}}
      {{setBodyClass 'has-modal'}}
      <div
        style={{cssVar
          boxel-modal-z-index=(if
            (bool @zIndex)
            @zIndex
            (if
              (eq @layer 'urgent')
              'var(--boxel-layer-modal-urgent)'
              'var(--boxel-layer-modal-default)'
            )
          )
        }}
      >
        <button
          disabled={{@isOverlayDismissalDisabled}}
          type='button'
          {{on 'click' @onClose}}
          class='overlay'
          style={{cssVar
            boxel-modal-overlay-color=@boxelModalOverlayColor
            boxel-modal-background-image-url=this.backgroundImageURL
          }}
          tabindex='-1'
        >
          <span class='boxel-sr-only'>Close modal</span>
        </button>

        <dialog
          class='{{@size}} {{if @centered "centered"}}'
          open={{@isOpen}}
          aria-modal='true'
          ...attributes
        >
          <div class='boxel-modal__inner'>
            {{yield}}
          </div>
        </dialog>
      </div>
    {{/if}}
    <style>
      dialog {
        /* Unit is required to be used on calc */
        --boxel-modal-offset-top: 0px;
        --boxel-modal-offset-left: 0px;
        --boxel-modal-offset-right: 0px;

        position: fixed;
        width: 100%;
        height: calc(100vh - var(--boxel-modal-offset-top));
        top: var(--boxel-modal-offset-top);
        left: var(--boxel-modal-offset-left);
        right: var(--boxel-modal-offset-right);
        padding: 0 var(--boxel-sp);
        background: none;
        border: none;
        overflow: hidden;
        z-index: var(--boxel-modal-z-index);
        pointer-events: none;
      }

      .centered {
        top: 50%;
        transform: translateY(-50%);
      }

      .overlay {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        padding: 0;
        border: none;
        background-color: var(--boxel-modal-overlay-color, rgb(39 45 48 / 50%));
        background-image: var(--boxel-modal-background-image-url);
        background-position: center;
        background-size: cover;
        text-align: left;
        z-index: calc(var(--boxel-modal-z-index) - 1);
      }

      .x-small {
        --boxel-modal-max-width: 23.25rem; /* 300px */
      }

      .small {
        --boxel-modal-max-width: 36.25rem; /* 580px */
      }

      .medium {
        --boxel-modal-max-width: 43.75rem; /* 700px */
      }

      .large {
        --boxel-modal-offset-top: var(--boxel-sp-lg);
        --boxel-modal-max-width: 65rem; /* 1040px */
      }

      .full-screen {
        padding: 0;
        top: 0;
        left: 0;
        right: 0;
      }

      .full-screen > .boxel-modal__inner {
        max-width: inherit;
      }

      :global(.boxel-modal__inner) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        margin: auto;
        max-width: var(--boxel-modal-max-width, 65rem);
      }

      :global(.boxel-modal__inner > *) {
        width: 100%;
        pointer-events: auto;
        cursor: default;
      }
    </style>
  </template>
}
