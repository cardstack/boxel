import GlimmerComponent from '@glimmer/component';
import CardListingContainer from '../components/card-listing-container';

interface FilterSectionArgs {
  Blocks: {};
  Element: HTMLElement;
}

export default class FilterSection extends GlimmerComponent<FilterSectionArgs> {
  <template>
    <CardListingContainer
      role='complementary'
      aria-label='Filters'
      class='filter-section'
      ...attributes
    >
      <section class='filter-group'>
        {{! Todo: Featured, we can choose to use button or others }}
        <h3 id='featured-heading' class='filter-heading'>Featured</h3>
      </section>

      <section class='filter-group'>
        {{! Todo: Category Subtree }}
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
    </CardListingContainer>

    <style scoped>
      @layer {
        .filter-section {
          --card-listing-container-height: 100%;
          --card-listing-container-width: 247px;
          --card-listing-container-background-color: var(--boxel-light);
          --card-listing-container-border-radius: var(--boxel-border-radius);

          position: sticky;
          top: 0;
          display: flex;
          flex-direction: column;
          gap: var(--filter-section-gap, var(--boxel-sp-sm));
          overflow-y: hidden;
        }
        .filter-section:hover {
          overflow-y: auto;
        }
        .filter-heading {
          margin: 0;
          padding: var(--filter-section-heading-padding, var(--boxel-sp-sm));
          font-weight: var(--filter-section-heading-font-weight, 600);
        }
      }
    </style>
  </template>
}
