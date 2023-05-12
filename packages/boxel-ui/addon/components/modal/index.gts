import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { eq } from '../../helpers/truth-helpers';
import cssVar from '../../helpers/css-var';
import cn from '../../helpers/cn';
// import setBodyClass from 'ember-set-body-class/helpers/set-body-class';

interface Signature {
  Element: HTMLDialogElement;
  Args: {
    imgURL?: string;
    size?: 'small' | 'medium' | 'large';
    layer?: 'urgent';
    isOpen?: boolean;
    isOverlayDismissalDisabled?: boolean;
    onClose: () => void;
    boxelModalOverlayColor?: string;
  };
  Blocks: {
    default: [];
  };
}

export default class Modal extends Component<Signature> {
  <template>
    {{#if @isOpen}}
      {{!-- {{setBodyClass "has-modal"}} --}}
      <div
        style={{cssVar
          boxel-modal-z-index=(if
            (eq @layer 'urgent')
            'var(--boxel-layer-modal-urgent)'
            'var(--boxel-layer-modal-default)'
          )
        }}
      >
        <button
          disabled={{@isOverlayDismissalDisabled}}
          type='button'
          {{on 'click' @onClose}}
          class='boxel-modal-overlay'
          style={{cssVar boxel-modal-overlay-color=@boxelModalOverlayColor}}
          tabindex='-1'
        >
          <span class='boxel-sr-only'>Close modal</span>
        </button>

        <dialog
          class={{cn
            'boxel-modal'
            boxel-modal--small=(eq @size 'small')
            boxel-modal--medium=(eq @size 'medium')
            boxel-modal--large=(eq @size 'large')
          }}
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
  </template>
}
