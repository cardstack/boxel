import GlimmerComponent from '@glimmer/component';

interface FilterSectionArgs {
  Blocks: {};
  Element: HTMLElement;
}

export default class FilterSection extends GlimmerComponent<FilterSectionArgs> {
  <template>
    <div
      role='complementary'
      aria-label='Filters'
      class='filter-section'
      ...attributes
    >
      <section class='filter-group'>
        <h3 id='featured-heading' class='filter-heading'>Featured</h3>
      </section>
      <section class='filter-group'>
        <h3 id='category-heading' class='filter-heading'>Categories</h3>
        <div aria-labelledby='category-heading'>
          {{! TODO: Add category filter component here }}
        </div>
      </section>
    </div>

    <style scoped>
      .filter-section {
        position: sticky;
        top: var(--catalog-app-layout-padding-top);
        padding-right: var(--boxel-sp-sm);
        height: 100%;
        overflow-y: hidden;
        width: 247px;
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        display: flex;
        flex-direction: column;
      }
      .filter-section:hover {
        overflow-y: auto;
      }
      .filter-heading {
        margin: 0;
        padding: var(--boxel-sp-sm);
        font-weight: 600;
      }
    </style>
  </template>
}
