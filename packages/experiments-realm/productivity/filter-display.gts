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
    icon: any;
  };
  Element: HTMLDivElement;
  Blocks: {
    default: [any];
  };
}

export class FilterDisplay extends GlimmerComponent<FilterDisplaySignature> {
  <template>
    {{#each @items as |item|}}
      <Pill class='filter-display-pill'>
        <:default>
          {{#if @icon}}
            <@icon class='filter-display-icon' />
          {{/if}}
          {{@key}}
          =
          <strong>{{yield item}}</strong>
        </:default>
        <:iconRight>
          <IconButton
            @icon={{IconX}}
            {{on 'click' (fn @removeItem item)}}
            class='filter-display-remove-button'
          />
        </:iconRight>
      </Pill>
    {{/each}}
    <style scoped>
      .filter-display-pill {
        flex-shrink: 0;
        font: 500 var(--boxel-font-sm);
        --pill-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxs);
        --pill-background-color: var(--boxel-100);
      }
      .filter-display-remove-button {
        --boxel-icon-button-height: 10px;
        --boxel-icon-button-width: 10px;
        --inner-boxel-icon-button-width: 8px;
        --inner-boxel-icon-button-height: 8px;
      }
      .filter-display-icon {
        width: 15px;
        height: 15px;
        margin-right: var(--boxel-sp-xxxs);
      }
      strong {
        font-weight: 600;
      }
    </style>
  </template>
}
