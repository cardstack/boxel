import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import {
  Card as CardIcon,
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '../../icons.gts';
import RadioInput from '../radio-input/index.gts';

interface ViewItem {
  icon: ComponentLike;
  id: string;
}

interface Signature {
  Args: {
    items?: ViewItem[];
    onChange: (id: string) => void;
    selectedId: string | undefined;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export default class ViewSelector extends Component<Signature> {
  standardViewOptions: ViewItem[] = [
    { id: 'card', icon: CardIcon },
    { id: 'strip', icon: StripIcon },
    { id: 'grid', icon: GridIcon },
  ];
  viewOptions = this.args.items ?? this.standardViewOptions;

  get selectedId() {
    return this.args.selectedId ?? (this.viewOptions[0] as ViewItem).id;
  }

  <template>
    <div class='view-options-group' ...attributes>
      {{! TODO: refactor styling of RadioInput component to display legend instead of repeating it here }}
      View as
      <RadioInput
        class='view-options'
        @groupDescription='View as'
        @name='view-options'
        @items={{this.viewOptions}}
        @spacing='compact'
        @hideRadio={{true}}
        @hideBorder={{true}}
        as |item|
      >
        {{#let item.data.id as |id|}}
          <item.component
            class={{cn 'view-option' is-selected=(eq this.selectedId id)}}
            @checked={{eq this.selectedId id}}
            @onChange={{fn @onChange id}}
          >
            <item.data.icon width='20' height='20' alt={{id}} />
          </item.component>
        {{/let}}
      </RadioInput>
    </div>
    <style scoped>
      .view-options-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 var(--boxel-sp-sm);
        text-wrap: nowrap;
      }
      .view-options {
        --boxel-radio-gap: var(--boxel-sp-4xs);
      }
      .view-options > :deep(div) {
        flex-wrap: nowrap;
      }
      .view-option {
        display: flex;
        color: var(--boxel-450);
        box-shadow: none;
        transition: none;
      }
      .view-option > :deep(div) {
        display: contents;
      }
      .view-option:hover,
      .view-option.is-selected {
        color: var(--boxel-dark);
      }
    </style>
  </template>
}
