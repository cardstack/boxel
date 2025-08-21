import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import ImageCarouselComponent from './image-carousel';
import { type ListingActions } from '../resources/helpers/listing-action-resolver';

interface CatalogImageOverlaySignature {
  Element: HTMLElement;
  Args: {
    listingActions: ListingActions;
    images: string[];
  };
  Blocks: {
    icon: [];
  };
}

export class CatalogImageOverlay extends GlimmerComponent<CatalogImageOverlaySignature> {
  @action
  stopPropagationAndCall(callback: (() => void | Promise<void>) | undefined) {
    return async (e: MouseEvent) => {
      e.stopPropagation();
      if (callback) {
        await callback();
      }
    };
  }

  get skillActions() {
    if (this.args.listingActions.type === 'skill') {
      return this.args.listingActions;
    }
    return;
  }

  <template>
    <ImageCarouselComponent
      @items={{@images}}
      class='catalog-image-overlay'
      tabindex='0'
      data-test-catalog-listing-fitted-preview
      aria-label='Preview Example'
      {{on 'click' (this.stopPropagationAndCall @listingActions.preview)}}
    >
      <:overlay>
        <div class='actions-buttons-container'>
          {{#if @listingActions.preview}}
            <BoxelButton
              @kind='secondary-dark'
              class='overlay-button'
              data-test-catalog-listing-fitted-preview-button
              aria-label='Preview Example'
              {{on
                'click'
                (this.stopPropagationAndCall @listingActions.preview)
              }}
            >
              Preview
            </BoxelButton>
          {{/if}}

          {{#if this.skillActions}}
            {{#if this.skillActions.addSkillsToRoom}}

              <BoxelButton
                @kind='secondary-dark'
                class='overlay-button'
                data-test-catalog-listing-fitted-add-skills-to-room-button
                aria-label='Add Skills to Current Room'
                {{on
                  'click'
                  (this.stopPropagationAndCall
                    this.skillActions.addSkillsToRoom
                  )
                }}
              >
                Use Skills
              </BoxelButton>
            {{/if}}
          {{/if}}

          <BoxelButton
            @kind='secondary-dark'
            class='overlay-button'
            data-test-catalog-listing-fitted-details-button
            aria-label='View Listing Details'
            {{on 'click' (this.stopPropagationAndCall @listingActions.view)}}
          >
            Details
          </BoxelButton>
        </div>
      </:overlay>
      <:icon>
        {{yield to='icon'}}
      </:icon>
    </ImageCarouselComponent>

    <style scoped>
      @layer {
        .catalog-image-overlay {
          outline: none;
        }
        .catalog-image-overlay:focus-visible {
          outline: 2px solid var(--boxel-highlight);
          outline-offset: 2px;
        }

        .actions-buttons-container {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: var(--boxel-sp-sm);
          opacity: 0;
          background-color: rgba(0, 0, 0, 0.6);
          transition: opacity 0.3s ease;
          pointer-events: auto;
        }

        .catalog-image-overlay:hover .actions-buttons-container {
          opacity: 1;
        }

        .overlay-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          --boxel-button-border: 1px solid var(--boxel-light);
          --boxel-button-text-color: var(--boxel-100);
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.12),
            0 5px 10px rgba(0, 0, 0, 0.1);
          pointer-events: auto;
          min-width: 100px;
        }
        .overlay-button:hover {
          --boxel-button-text-color: var(--boxel-light);
          --boxel-button-color: var(--boxel-purple);
          box-shadow:
            0 15px 25px rgba(0, 0, 0, 0.2),
            0 7px 15px rgba(0, 0, 0, 0.15);
          cursor: pointer;
        }

        @container (max-width: 250px) {
          .actions-buttons-container {
            flex-direction: column;
          }
          .overlay-button {
            --boxel-button-font: 600 var(--boxel-font-xs);
            --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp);
          }
        }

        @container (max-height: 140px) {
          .actions-buttons-container,
          .carousel-nav,
          .carousel-dots {
            display: none;
          }
          .carousel-item {
            padding: var(--boxel-sp-4xs);
          }
          .carousel-item img,
          .carousel:hover .carousel-item img {
            box-shadow: none;
            border-radius: var(--boxel-border-radius-xs);
          }
        }
      }
    </style>
  </template>
}
