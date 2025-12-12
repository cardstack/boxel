import { CardDef, CardContext } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';

import CardsDisplaySection, {
  CardsIntancesGrid,
} from './cards-display-section';

interface ShowcaseViewArgs {
  Args: {
    startHereListings?: CardDef[];
    newListings?: CardDef[];
    featuredListings?: CardDef[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

export default class ShowcaseView extends GlimmerComponent<ShowcaseViewArgs> {
  <template>
    <header class='showcase-header'>
      <img
        src='https://boxel-images.boxel.ai/icons/icon_catalog_rounded.png'
        alt='Catalog Icon'
        class='catalog-icon'
      />
      <h1 class='showcase-header-title'>
        Cardstack Catalog: Discover & Remix the Best
      </h1>
    </header>

    <hr class='showcase-divider' />

    <div class='showcase-center-div' data-test-showcase-view ...attributes>
      <div class='showcase-display-container'>
        <CardsDisplaySection class='showcase-cards-display'>
          <:intro>
            <h2 class='intro-title'>Starter stack — Begin Here</h2>
            <p class='intro-description'>These are the foundational tools we
              think every builder should have. Whether you're just exploring or
              setting up your workspace for serious work, start with these
              must-haves.</p>
          </:intro>
          <:content>
            <CardsIntancesGrid
              @cards={{@startHereListings}}
              @context={{@context}}
            />
          </:content>
        </CardsDisplaySection>

        <hr class='showcase-divider' />

        <CardsDisplaySection class='new-this-week-cards-display'>
          <:intro>
            <h2 class='intro-title'>Editor's Picks – What's Hot This Week</h2>
            <p class='intro-description'>These new entries have caught the
              community's eye, whether for creative flair, clever utility, or
              just plain polish.
            </p>
          </:intro>
          <:content>
            <CardsIntancesGrid @cards={{@newListings}} @context={{@context}} />
          </:content>
        </CardsDisplaySection>

        <hr class='showcase-divider' />

        <CardsDisplaySection class='featured-cards-display'>
          <:intro>
            <h2 class='intro-title'>Feature Collection – Personal Organization</h2>
            <p class='intro-description'>A hand-picked duo of focused, flexible
              tools for personal project management.</p>
          </:intro>
          <:content>
            <CardsIntancesGrid
              @cards={{@featuredListings}}
              @context={{@context}}
            />
          </:content>
        </CardsDisplaySection>
      </div>
    </div>

    <style scoped>
      .showcase-header {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .catalog-icon {
        width: 2rem;
        height: 2rem;
        flex-shrink: 0;
      }
      .showcase-header-title {
        font-size: 1.5rem;
        font-weight: 600;
        line-height: 1.2;
        margin-block: 0;
      }

      .showcase-divider {
        border: none;
        height: 1px;
        background-color: #999999;
        margin: var(--boxel-sp-xl) 0;
      }

      .showcase-center-div {
        display: table;
        margin: 0 auto;
        width: 100%;
      }

      .showcase-display-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        container-name: showcase-display-container;
        container-type: inline-size;
      }
      .showcase-cards-display :deep(.cards.grid-view),
      .featured-cards-display :deep(.cards.grid-view) {
        grid-template-columns: repeat(2, 1fr);
      }
      .new-this-week-cards-display :deep(.cards.grid-view) {
        grid-template-columns: repeat(4, 1fr);
      }

      .intro-title {
        font: 600 var(--boxel-font-lg);
        margin-block: 0;
        color: var(--boxel-dark);
      }
      .intro-description {
        font: 400 var(--boxel-font);
        color: var(--boxel-dark);
        margin-bottom: var(--boxel-sp-xl);
      }

      @container showcase-display-container (inline-size <= 768px) {
        .new-this-week-cards-display :deep(.cards.grid-view) {
          grid-template-columns: repeat(2, 1fr);
        }

        @container showcase-display-container (inline-size <= 500px) {
          .showcase-cards-display :deep(.cards.grid-view),
          .new-this-week-cards-display :deep(.cards.grid-view),
          .featured-cards-display :deep(.cards.grid-view) {
            grid-template-columns: 1fr;
          }
        }
      }
    </style>
  </template>
}
