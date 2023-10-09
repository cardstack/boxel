import Component from '@glimmer/component';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import Item from './item';
import { hash } from '@ember/helper';

export interface Signature {
  Element: HTMLFieldSetElement;
  Args: {
    checkedId?: string;
    disabled?: boolean;
    errorMessage?: string;
    invalid?: boolean;
    items: any[];
    groupDescription: string;
    name: string;
    orientation?: string;
    spacing?: string;
    hideBorder?: boolean;
    hideRadio?: boolean;
  };
  Blocks: {
    default: [
      {
        component: any;
        data: any;
        index: number;
      },
    ];
  };
}

export default class RadioInput extends Component<Signature> {
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
  }
  <template>
    <style>
      .boxel-radio-fieldset {
        border: 0;
        padding: 0.01em 0 0;
        min-width: 0;
      }

      .boxel-radio-fieldset__legend {
        opacity: 0;
        position: absolute;
        left: -9999px;
        max-width: 1px;
        max-height: 1px;
        white-space: nowrap;
      }

      /* Div container inside the fieldset component. Use \`display: contents\` to move
    these styles up when that css property is more widely available. */
      .boxel-radio-fieldset__container {
        --boxel-radio-gap: var(--boxel-sp);

        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-radio-gap);
        width: 100%;
        max-width: 100%;
        --boxel-radio-input-option-padding: var(--boxel-sp);
        --boxel-radio-input-option-gap: var(--boxel-sp-sm);
      }

      .boxel-radio-fieldset__container--vertical {
        flex-direction: column;
      }

      .boxel-radio-fieldset__container--compact {
        --boxel-radio-gap: var(--boxel-sp-xxs);
        --boxel-radio-input-option-padding: var(--boxel-sp-xxxs);
        --boxel-radio-input-option-gap: var(--boxel-sp-xxxs);
      }

      .boxel-radio-fieldset__container--horizontal > * {
        flex: 1;
      }
    </style>
    <fieldset class='boxel-radio-fieldset' disabled={{@disabled}} ...attributes>
      <legend class='boxel-radio-fieldset__legend'>
        {{@groupDescription}}
      </legend>
      {{! this div is necessary because Chrome has a special case for fieldsets and it breaks grid auto placement }}
      <div
        class={{cn
          'boxel-radio-fieldset__container'
          boxel-radio-fieldset__container--compact=(eq @spacing 'compact')
          boxel-radio-fieldset__container--horizontal=(eq
            @orientation 'horizontal'
          )
          boxel-radio-fieldset__container--vertical=(eq @orientation 'vertical')
        }}
      >
        {{#each @items as |item i|}}
          {{yield
            (hash
              component=(component
                Item
                name=@name
                disabled=@disabled
                checked=(if @checkedId (eq @checkedId item.id))
                hideRadio=@hideRadio
                hideBorder=@hideBorder
              )
              data=item
              index=i
            )
          }}
        {{/each}}
      </div>
    </fieldset>
  </template>
}
