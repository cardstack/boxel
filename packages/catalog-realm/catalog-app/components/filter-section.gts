import GlimmerComponent from '@glimmer/component';
import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

interface FilterCategoryGroupArgs {
  Args: {
    title: string;
    items: Array<{ id: string; name: string }>;
    activeId: string;
    onItemSelect: (item: { id: string; name: string }) => void;
  };
}

export class FilterCategoryGroup extends GlimmerComponent<FilterCategoryGroupArgs> {
  @action
  handleItemClick(item: { id: string; name: string }) {
    this.args.onItemSelect(item);
  }

  <template>
    <section class='filter-group'>
      <h2 class='filter-heading'>
        {{@title}}
      </h2>

      <div class='filter-list'>
        {{#each @items as |item|}}
          <button
            class={{concat
              'filter-button'
              (if (eq @activeId item.id) ' selected')
            }}
            {{on 'click' (fn this.handleItemClick item)}}
            data-test-filter-button={{item.id}}
          >
            {{item.name}}
          </button>
        {{/each}}
      </div>
    </section>

    <style scoped>
      @layer {
        .filter-group {
          display: flex;
          flex-direction: column;
        }
        .filter-heading {
          font: 500 var(--boxel-font);
          margin: 0;
          padding: var(--boxel-sp-sm);
          border-bottom: 1px solid var(--boxel-border-color);
        }
        .filter-list {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-sm);
        }
        .filter-button {
          text-align: left;
          background: none;
          border: none;
          font: 500 var(--boxel-font-sm);
          padding: var(--boxel-sp-xxs);
          margin-bottom: var(--boxel-sp-4xs);
        }
        .filter-button.selected {
          color: var(--boxel-light);
          background: var(--boxel-dark);
          border-radius: 6px;
        }
        .filter-button:not(.selected):hover {
          background: var(--boxel-300);
          border-radius: 6px;
        }
      }
    </style>
  </template>
}
