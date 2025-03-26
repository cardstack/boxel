import GlimmerComponent from '@glimmer/component';
import ContentContainer from '../components/content-container';

interface FilterSectionArgs {
  Blocks: {};
  Element: HTMLElement;
}

export default class FilterSection extends GlimmerComponent<FilterSectionArgs> {
  <template>
    <ContentContainer
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
          margin: 0;
          padding: var(--filter-section-heading-padding, var(--boxel-sp-sm));
          font-weight: var(--filter-section-heading-font-weight, 600);
        }
      }
    </style>
  </template>
}
