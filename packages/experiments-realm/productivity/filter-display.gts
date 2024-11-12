import GlimmerComponent from '@glimmer/component';
import { Pill, IconButton } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export interface FilterDisplaySignature {
  Args: {
    key: string;
    items: any[];
    removeItem: (item: any) => void;
  };
  Element: HTMLDivElement;
  Blocks: {
    default: [any];
  };
}

// Per class
export class FilterDisplay extends GlimmerComponent<FilterDisplaySignature> {
  <template>
    <div class='filter-display'>
      {{#each @items as |item|}}
        <Pill>
          <:default>
            {{@key}}
            =
            {{yield item}}
          </:default>
          <:iconRight>
            <IconButton
              @icon={{IconX}}
              {{on 'click' (fn @removeItem @key item)}}
            />
          </:iconRight>
        </Pill>
      {{/each}}
    </div>
    <style scoped>
      .filter-display {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .filter-display__remove-button {
        all: unset;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 20px;
        height: 20px;
        cursor: pointer;
        border-radius: 50%;
        transition: background-color 0.2s ease;
      }
      .filter-display-icon--remove {
        width: 10px;
        height: 10px;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}
