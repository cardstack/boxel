import { hash } from '@ember/helper';
import { get } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import Item from './item.gts';

export interface Signature {
  Args: {
    checkedId?: string;
    disabled?: boolean;
    errorMessage?: string;
    groupDescription: string;
    hideBorder?: boolean;
    hideRadio?: boolean;
    invalid?: boolean;
    items: any[];
    keyName?: string;
    name: string;
    orientation?: string;
    spacing?: string;
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
  Element: HTMLFieldSetElement;
}

export default class RadioInput extends Component<Signature> {
  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
  }

  get checkedKey() {
    return this.args.keyName || 'id';
  }

  <template>
    <style scoped>
      @layer {
        .boxel-radio-fieldset {
          --boxel-radio-gap: var(--boxel-sp);
          --boxel-radio-input-option-padding: var(--boxel-sp);
          --boxel-radio-input-option-gap: var(--boxel-sp-sm);
          border: 0;
          margin-inline: 0;
          padding: 0.01em 0 0;
          min-width: 0;
        }
        .boxel-radio-fieldset--compact {
          --boxel-radio-gap: var(--boxel-sp-xxs);
          --boxel-radio-input-option-padding: var(--boxel-sp-xxxs);
          --boxel-radio-input-option-gap: var(--boxel-sp-xxxs);
        }

        .boxel-radio-fieldset__legend {
          opacity: 0;
          position: absolute;
          left: -9999px;
          max-width: 1px;
          max-height: 1px;
          white-space: nowrap;
        }

        /* Div container inside the fieldset component. Use display: contents to move
    these styles up when that css property is more widely available. */
        .boxel-radio-fieldset__container {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-radio-gap);
          width: 100%;
          max-width: 100%;
        }

        .boxel-radio-fieldset__container--vertical {
          flex-direction: column;
        }

        .boxel-radio-fieldset__container--horizontal > * {
          flex: 1;
        }
      }
    </style>
    <fieldset
      class={{cn
        'boxel-radio-fieldset'
        boxel-radio-fieldset--compact=(eq @spacing 'compact')
      }}
      disabled={{@disabled}}
      ...attributes
    >
      <legend class='boxel-radio-fieldset__legend'>
        {{@groupDescription}}
      </legend>
      {{! this div is necessary because Chrome has a special case for fieldsets and it breaks grid auto placement }}
      <div
        class={{cn
          'boxel-radio-fieldset__container'
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
                id=item.id
                name=@name
                disabled=@disabled
                checked=(if
                  @checkedId (eq @checkedId (get item this.checkedKey))
                )
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
