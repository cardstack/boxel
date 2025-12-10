import GlimmerComponent from '@glimmer/component';
import { SkeletonPlaceholder } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLElement;
}

export default class ListingFittedSkeleton extends GlimmerComponent<Signature> {
  <template>
    <div class='fitted-skeleton-wrapper' ...attributes>
      <div class='fitted-skeleton'>
        <div class='display-section'></div>
        <div class='info-section'>
          <div class='card-content'>
            <SkeletonPlaceholder class='title-skeleton' />
            <SkeletonPlaceholder class='publisher-skeleton' />
          </div>
          <div class='card-tags-action'>
            <SkeletonPlaceholder class='tag-skeleton' />
            <SkeletonPlaceholder class='button-skeleton' />
          </div>
        </div>
      </div>
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      @layer {
        .fitted-skeleton-wrapper {
          container-name: fitted-card;
          container-type: size;
          width: 100%;
          height: 100%;
        }
        .fitted-skeleton {
          width: 100%;
          height: 100%;
          display: flex;
          overflow: hidden;
        }
        .display-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          background-color: var(--boxel-200);
        }
        .info-section {
          display: flex;
          gap: var(--boxel-sp-sm);
          width: 100%;
          overflow: hidden;
          text-align: left;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .card-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
        }
        .card-tags-action {
          display: flex;
          align-items: end;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .title-skeleton {
          height: 1.25em;
          width: 80%;
          border-radius: var(--boxel-border-radius-xs);
        }
        .publisher-skeleton {
          height: 0.875em;
          width: 60%;
          border-radius: var(--boxel-border-radius-xs);
        }
        .tag-skeleton {
          height: 0.875em;
          width: 3rem;
          border-radius: var(--boxel-border-radius-xs);
        }
        .button-skeleton {
          height: 1.75rem;
          width: 3.5rem;
          border-radius: var(--boxel-border-radius-sm);
        }

        /* Aspect Ratio <= 1.0 (Vertical) */
        @container fitted-card (aspect-ratio <= 1.0) {
          .fitted-skeleton {
            flex-direction: column;
          }
          .display-section {
            width: 100%;
            height: 68cqmax;
          }
          .info-section {
            flex-direction: column;
            justify-content: space-between;
            height: 100%;
            padding: var(--boxel-sp-xs);
          }
          .card-tags-action {
            flex-direction: row;
            justify-content: space-between;
          }
          .button-skeleton {
            height: 1.5rem;
            width: 3rem;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
          .display-section {
            display: none;
          }
        }

        /* Vertical Tiles*/
        /* Small Tile (150 x 170) */
        @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
          .title-skeleton {
            height: 1.125em;
          }
        }

        /* CardsGrid Tile (170 x 250) */
        @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px ) and (170px < height < 275px) {
          .display-section {
            height: 55cqmax;
          }
          .title-skeleton {
            height: 1em;
          }
          .publisher-skeleton,
          .tag-skeleton {
            display: none;
          }
          .button-skeleton {
            height: 1.25rem;
            width: 2.5rem;
          }
        }

        /* Tall Tile (150 x 275) */
        @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
          .title-skeleton {
            height: 1em;
          }
        }

        /* Large Tile (250 x 275) */
        @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
          .title-skeleton {
            height: 1em;
          }
        }

        /* Vertical Cards */
        @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
          .title-skeleton {
            height: 1.375em;
          }
        }

        /* 1.0 < Aspect Ratio (Horizontal) */
        @container fitted-card (1.0 < aspect-ratio) {
          .display-section {
            aspect-ratio: 1;
            max-width: 44%;
          }
          .info-section {
            flex-direction: column;
            justify-content: space-between;
          }
          .card-tags-action {
            flex-direction: row;
            justify-content: space-between;
          }
          .tag-skeleton {
            display: none;
          }
        }

        @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
          .info-section {
            align-self: center;
          }
        }

        /* Badges */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
          .display-section {
            display: none;
          }
        }

        /* Small Badge (150 x 40) */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
          .title-skeleton {
            height: 0.875em;
          }
          .publisher-skeleton {
            margin-top: 0;
          }
        }

        /* Large Badge (150 x 105) */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
          .title-skeleton {
            height: 1.125em;
          }
        }

        /* Strips */
        /* Single Strip (250 x 40) */
        @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
          .fitted-skeleton {
            padding: var(--boxel-sp-xxxs);
          }
          .publisher-skeleton {
            display: none;
          }
        }

        /* Horizontal Tiles */
        /* Regular Tile (250 x 170) */
        @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
          .title-skeleton {
            height: 1.125em;
          }
        }

        /* Horizontal Cards */
        /* Compact Card  */
        @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
          .display-section {
            height: 100%;
          }
          .title-skeleton {
            height: 1.125em;
          }

          @container fitted-card (height <= 65px) {
            .title-skeleton {
              height: 1em;
            }
          }
        }

        /* Full Card (400 x 275) */
        @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
          .title-skeleton {
            height: 1.375em;
          }
          .info-section {
            padding: var(--boxel-sp);
          }
        }

        /* Control Card which is Smaller than */
        @container fitted-card (aspect-ratio <= 1.0) and (width <= 275px) {
          .tag-skeleton {
            display: none;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (height <= 275px) {
          .title-skeleton {
            height: 1em;
          }
          .publisher-skeleton {
            display: none;
          }
        }

        /* Control linked to many component fitted size */
        @container fitted-card (height <= 65px) {
          .display-section {
            padding: var(--boxel-sp-xs);
          }
          .card-tags-action {
            display: none;
          }
        }
      }
    </style>
  </template>
}
