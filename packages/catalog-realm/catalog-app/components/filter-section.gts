import GlimmerComponent from '@glimmer/component';
import ContentContainer from '../components/content-container';

import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

interface FilterSectionArgs {
  Args: {
    onFilterChange: (filterType: string, value: any) => void;
  };
  Blocks: {};
  Element: HTMLElement;
}

type Category = {
  id: string;
  name: string;
};

export default class FilterSection extends GlimmerComponent<FilterSectionArgs> {
  mockCategories: Category[] = [
    {
      id: 'all',
      name: 'All',
    },
    {
      id: 'business',
      name: 'Business',
    },
    {
      id: 'accounting',
      name: 'Accounting',
    },
    {
      id: 'collaboration',
      name: 'Collaboration',
    },
  ];

  @tracked activeFilter = this.mockCategories[0];

  // For now we handle the active filter at the component level, this is just for styling purpose
  // active category filter, activetags filter etc..
  @tracked activeCategoryFilterId = this.activeFilter.id;

  @action
  updateCategory(category: Category) {
    this.activeCategoryFilterId = category.id;
    this.args.onFilterChange('categories', category.name);
  }

  <template>
    <ContentContainer
      role='complementary'
      aria-label='Filters'
      class='filter-section'
      ...attributes
    >
      <section class='filter-group'>
        <h2 class='filter-heading'>
          Categories
        </h2>

        <div class='filter-category-list'>
          {{#each this.mockCategories as |category|}}
            <button
              class={{concat
                'filter-category-button'
                (if (eq this.activeCategoryFilterId category.id) ' selected')
              }}
              {{on 'click' (fn this.updateCategory category)}}
              data-test-boxel-filter-category-button={{category.id}}
            >
              {{category.name}}
            </button>
          {{/each}}
        </div>
      </section>

      <section class='filter-group'>
        {{! Todo: Search }}
      </section>

      <section class='filter-group'>
        {{! Todo: Tags }}
      </section>

      <section class='filter-group'>
        {{! Todo: Access Tier  }}
      </section>

      <section class='filter-group'>
        {{! Todo: Price Range }}
      </section>
    </ContentContainer>

    <style scoped>
      @layer {
        .filter-section {
          --content-container-height: 100%;
          --content-container-width: 100%;
          --content-container-background-color: var(--boxel-light);

          display: flex;
          flex-direction: column;
          gap: var(--filter-section-gap, var(--boxel-sp-sm));
          overflow-y: hidden;
        }
        .filter-section:hover {
          overflow-y: auto;
        }
        .filter-heading {
          font: 500 var(--boxel-font);
          margin: 0;
          padding: var(--filter-section-heading-padding, var(--boxel-sp-sm));
          border-bottom: 1px solid var(--boxel-border-color);
        }

        /* Category Filter */
        .filter-category-list {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-sm);
        }
        .filter-category-button {
          text-align: left;
          background: none;
          border: none;
          font: 500 var(--boxel-font-sm);
          padding: var(--boxel-sp-xxs);
          margin-bottom: var(--boxel-sp-4xs);
          display: flex;
          gap: var(--boxel-sp-4xs);
        }
        .filter-category-button.selected {
          color: var(--boxel-light);
          background: var(--boxel-dark);
          border-radius: 6px;
        }
        .filter-category-button:not(.selected):hover {
          background: var(--boxel-300);
          border-radius: 6px;
        }
      }
    </style>
  </template>
}
