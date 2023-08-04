import Component from '@glimmer/component';
import { Actions } from '@cardstack/runtime-common';
import { StackItem } from '@cardstack/host/components/operator-mode/container';
import OperatorModeStackItem from '@cardstack/host/components/operator-mode/stack-item';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    stackItems: StackItem[];
    stackIndex: number;
    publicAPI: Actions;
    backgroundImageURL: string | undefined;
    close: (stackItem: StackItem) => void;
    edit: (stackItem: StackItem) => void;
    save: (stackItem: StackItem, dismiss: boolean) => void;
  };
  Blocks: {};
}

export default class OperatorModeStack extends Component<Signature> {
  // TODO replace async action with ember concurrency task
  @action
  async dismissStackedCardsAbove(itemIndex: number) {
    let itemsToDismiss: StackItem[] = [];
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      itemsToDismiss.push(this.args.stackItems[i]);
    }
    await Promise.all(itemsToDismiss.map((i) => this.args.close(i)));
  }

  get backgroundImageStyle() {
    if (!this.args.backgroundImageURL) {
      return '';
    }
    return htmlSafe(`background-image: url(${this.args.backgroundImageURL});`);
  }

  <template>
    <div ...attributes style={{this.backgroundImageStyle}}>
      <div class='inner'>
        {{#each @stackItems as |item i|}}
          <OperatorModeStackItem
            @item={{item}}
            @index={{i}}
            @stackItems={{@stackItems}}
            @publicAPI={{@publicAPI}}
            @dismissStackedCardsAbove={{this.dismissStackedCardsAbove}}
            @close={{@close}}
            @edit={{@edit}}
            @save={{@save}}
          />
        {{/each}}
      </div>
    </div>

    <style>
      .operator-mode-stack {
        z-index: 0;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
        padding-top: var(--boxel-sp-lg);
      }

      .inner {
        height: calc(
          100% - var(--search-sheet-closed-height) + var(--boxel-sp)
        );
        position: relative;
        display: flex;
        justify-content: center;
        overflow: hidden;
        max-width: 50rem;
        padding-top: var(--boxel-sp-xxl);
        margin: 0 auto;
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }

      /* Add some padding to accomodate for overlaid header for embedded cards in operator mode */
      :global(.operator-mode-stack .embedded-card) {
        padding-top: calc(
          var(--overlay-embedded-card-header-height) + var(--boxel-sp-lg)
        );
      }
      /* This is repeated for the edit-card because specifying multiple selectors in :global don't work */
      :global(.operator-mode-stack .edit-card) {
        padding-top: calc(
          var(--overlay-embedded-card-header-height) + var(--boxel-sp-lg)
        );
      }

    </style>
  </template>
}
