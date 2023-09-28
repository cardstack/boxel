import Component from '@glimmer/component';
import { action } from '@ember/object';
import { type EmptyObject } from '@ember/component/helper';
import compact from 'ember-composable-helpers/helpers/compact';
import { on } from '@ember/modifier';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { fn } from '@ember/helper';

interface SelectorItemOptions {
  action: Function;
  url: string;
  selected: boolean;
  disabled: boolean;
}
export class SelectorItem {
  text: string;
  selected: boolean;
  disabled: boolean;
  action: Function | undefined;

  constructor(text: string, options: Partial<SelectorItemOptions>) {
    this.text = text;
    this.action = options.action;
    this.selected = options.selected || false;
    this.disabled = options.disabled || false;
  }
}

export function selectorItemFunc(
  params: [string, Function],
  named: Partial<SelectorItemOptions>,
): SelectorItem {
  let text = params[0];
  let opts = Object.assign({}, named);
  opts.action = params[1];
  return new SelectorItem(text, opts);
}

class SelectorItemRenderer extends Component<{
  Args: { selectorItem: SelectorItem };
  Blocks: {
    item: [SelectorItem];
  };
}> {
  get asSelectorItem(): SelectorItem {
    return this.args.selectorItem as SelectorItem;
  }
  <template>
    {{yield this.asSelectorItem to='item'}}
  </template>
}

interface Signature {
  Element: HTMLUListElement;
  Args: {
    class?: string;
    items: Array<SelectorItem>;
  };
  Blocks: EmptyObject;
}

export default class Selector extends Component<Signature> {
  @action invokeSelectorItemAction(
    action: unknown,
    e: Event | KeyboardEvent,
  ): void {
    e.preventDefault();

    if (e.type === 'keypress' && (e as KeyboardEvent).key !== 'Enter') {
      return;
    }

    (action as () => never)();
  }

  <template>
    <ul role='menu' class={{cn 'boxel-selector' @class}} ...attributes>
      {{#if @items}}
        {{#each (compact @items) as |selectorItem|}}
          <SelectorItemRenderer @selectorItem={{selectorItem}}>
            <:item as |selectorItem|>
              <li
                role='none'
                class={{cn
                  'boxel-selector__item'
                  boxel-selector__item--selected=selectorItem.selected
                  boxel-selector__item--disabled=selectorItem.disabled
                }}
                data-test-boxel-selector-item
                data-test-boxel-selector-item-selected={{selectorItem.selected}}
              >
                {{! template-lint-disable require-context-role }}
                <div
                  class='boxel-selector__item__content'
                  role='menuitem'
                  href='#'
                  data-test-boxel-selector-item-text={{selectorItem.text}}
                  {{on
                    'click'
                    (fn this.invokeSelectorItemAction selectorItem.action)
                  }}
                  {{on
                    'keypress'
                    (fn this.invokeSelectorItemAction selectorItem.action)
                  }}
                  disabled={{selectorItem.disabled}}
                >
                  <span class='selector-item'>
                    {{selectorItem.text}}
                  </span>
                </div>
              </li>
            </:item>
          </SelectorItemRenderer>
        {{/each}}
      {{/if}}
    </ul>
    <style>
      @layer {
        .boxel-selector {
          --boxel-selector-border-radius: var(--boxel-border-radius);
          --boxel-selector-color: var(--boxel-light);
          --boxel-selector-current-color: var(--boxel-light-100);
          --boxel-selector-selected-color: var(--boxel-highlight);
          --boxel-selector-disabled-color: var(--boxel-highlight);
          --boxel-selector-font: 500 var(--boxel-font-sm);
          --boxel-selector-item-gap: var(--boxel-sp-xxs);
          --boxel-selector-item-content-padding: var(--boxel-sp-xs)
            var(--boxel-sp);
          --boxel-selector-selected-background-color: var(--boxel-highlight);
          --boxel-selector-selected-font-color: var(--boxel-light-100);
          --boxel-selector-selected-hover-font-color: var(--boxel-light);
          --boxel-selector-selected-hover-background-color: var(
            --boxel-highlight-hover
          );
          list-style-type: none;
          margin: 0;
          padding: 0;
          background-color: var(--boxel-selector-color);
          border-radius: var(--boxel-selector-border-radius);
        }

        .boxel-selector__item {
          font: var(--boxel-selector-font);
          letter-spacing: var(--boxel-lsp-sm);
          border-radius: inherit;
        }

        .boxel-selector__item:hover {
          background-color: var(--boxel-selector-current-color);
          cursor: pointer;
        }

        .boxel-selector__item > .boxel-selector__item__content {
          width: 100%;
          padding: var(--boxel-selector-item-content-padding);
        }

        .boxel-selector__item--disabled .boxel-selector__item__content {
          pointer-events: none;
        }

        .boxel-selector__item > .boxel-selector__item__content:hover {
          color: inherit;
        }

        .boxel-selector__item__content:focus-visible {
          outline: var(--boxel-outline);
        }

        .boxel-selector__item--selected {
          background-color: var(--boxel-selector-selected-background-color);
          color: var(--boxel-selector-selected-font-color);
        }

        .boxel-selector__item--selected:hover {
          background-color: var(
            --boxel-selector-selected-hover-background-color
          );
        }

        .boxel-selector__item--dangerous {
          color: var(--boxel-danger);
          fill: var(--boxel-danger);
        }

        .boxel-selector__item--disabled,
        .boxel-selector__item--disabled.boxel-selector__item:hover {
          background-color: initial;
          opacity: 0.4;
        }

        .selector-item {
          display: flex;
          align-items: center;
          gap: var(--boxel-selector-item-gap);
        }
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    Selector: typeof Selector;
  }
}
