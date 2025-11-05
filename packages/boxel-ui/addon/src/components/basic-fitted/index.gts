import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';
import cssUrl from 'ember-css-url';

interface Signature {
  Args: {
    description?: string;
    iconComponent?: ComponentLike<{
      Element: Element;
    }>;
    isEmpty?: boolean;
    primary: string;
    secondary?: string;
    thumbnailURL?: string;
  };
  Element: HTMLDivElement;
}

const BasicFitted: TemplateOnlyComponent<Signature> = <template>
  <div class='fitted-template' ...attributes>
    {{#if @isEmpty}}
      {{! empty links-to field }}
      <div data-test-empty-field class='empty-field'></div>
    {{else}}
      <div class='thumbnail-section'>
        {{#if @thumbnailURL}}
          <div
            class='card-thumbnail'
            style={{cssUrl 'background-image' @thumbnailURL}}
          >
            {{#unless @thumbnailURL}}
              <div
                class='card-thumbnail-placeholder'
                data-test-card-thumbnail-placeholder
              />
            {{/unless}}
          </div>
        {{else}}
          <@iconComponent data-test-card-type-icon class='card-type-icon' />
        {{/if}}
      </div>
      <div class='info-section'>
        <h3 class='card-title' data-test-card-title>{{@primary}}</h3>
        <h4 class='card-display-name' data-test-card-display-name>
          {{@secondary}}
        </h4>
      </div>
      <div
        class='card-description'
        data-test-card-description
      >{{@description}}</div>
    {{/if}}
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      :global(.fitted-template) {
        width: 100%;
        height: 100%;
        display: flex;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--card);
        color: var(--card-foreground);
        overflow: hidden;
      }
      :global(.thumbnail-section) {
        flex-shrink: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
      }
      :global(.card-thumbnail) {
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--accent, var(--boxel-highlight));
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        border-radius: var(--boxel-border-radius-sm);
        width: 100%;
        height: 100%;
      }
      :global(.card-type-icon) {
        aspect-ratio: 1 / 1;
        min-width: 32px;
        min-height: 32px;
        max-height: 52px;
        max-width: 52px;
        width: 100%;
        height: auto;
      }
      :global(.info-section) {
        width: 100%;
        overflow: hidden;
      }
      :global(.card-title) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        margin-block: 0;
        font-weight: var(--boxel-font-weight-semibold);
        font-size: var(--boxel-font-size-sm);
        letter-spacing: var(--boxel-lsp-sm);
        line-height: 1.25;
        text-overflow: ellipsis;
      }
      :global(.card-display-name) {
        margin-top: var(--boxel-sp-4xs);
        margin-bottom: 0;
        color: var(--muted-foreground, var(--boxel-450));
        font-weight: var(--boxel-font-weight-medium);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-lineheight-xs);
        letter-spacing: var(--boxel-lsp-xs);
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
      }
      :global(.card-description) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-block: 0;
        font-weight: var(--boxel-font-weight-medium);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-lineheight-xs);
        letter-spacing: var(--boxel-lsp-xs);
        text-overflow: ellipsis;
      }

      /* Aspect Ratio <= 1.0 (Vertical) */
      /* Common */
      @container fitted-card ((aspect-ratio <= 1) and (height < 180px)) {
        :global(.card-title) {
          font-size: var(--boxel-font-size-xs);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) {
        :global(.fitted-template) {
          flex-direction: column;
        }
        :global(.thumbnail-section) {
          width: 100%;
          height: 50cqmin;
        }
        :global(.info-section) {
          text-align: center;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
        :global(.thumbnail-section) {
          display: none;
        }
      }
      /* Vertical Tiles*/
      /* Small Tile (150 x 170) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
        :global(.thumbnail-section) {
          min-height: 70px;
        }
        :global(.card-title) {
          -webkit-line-clamp: 2;
        }
        :global(.card-description) {
          display: none;
        }
      }
      /* CardsGrid Tile (170 x 250) */
      @container fitted-card (aspect-ratio <= 1.0) and (width = 170px) and (height = 250px) {
        :global(.thumbnail-section) {
          height: auto;
          aspect-ratio: 1 / 1;
        }
        :global(.card-title) {
          -webkit-line-clamp: 2;
        }
      }
      /* Tall Tile (150 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
        :global(.thumbnail-section) {
          min-height: 85px;
        }
        :global(.card-title) {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 4;
        }
      }
      /* Large Tile (250 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        :global(.thumbnail-section) {
          min-height: 150px;
        }
        :global(.card-title) {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 3;
        }
      }
      /* Vertical Cards */
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        :global(.fitted-template) {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        :global(.thumbnail-section) {
          min-height: 236px;
        }
        :global(.card-title) {
          font-size: var(--boxel-font-size-med);
          -webkit-line-clamp: 4;
        }
      }
      /* Expanded Card (400 x 445) */

      /* 1.0 < Aspect Ratio (Horizontal) */
      @container fitted-card (1.0 < aspect-ratio) {
        :global(.card-description) {
          display: none;
        }
        :global(.thumbnail-section) {
          aspect-ratio: 1;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
        :global(.info-section) {
          align-self: center;
        }
      }
      /* Badges */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        :global(.fitted-template) {
          padding: var(--boxel-sp-xxxs);
        }
        :global(.thumbnail-section) {
          display: none;
        }
      }
      /* Small Badge (150 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        :global(.card-title) {
          -webkit-line-clamp: 1;
          font-weight: var(--boxel-font-weight-semibold);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-lineheight-xs);
        }
        :global(.card-display-name) {
          margin-top: 0;
        }
      }
      /* Medium Badge (150 x 65) */

      /* Large Badge (150 x 105) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
        :global(.card-title) {
          -webkit-line-clamp: 3;
        }
      }

      /* Strips */
      /* Single Strip (250 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        :global(.fitted-template) {
          padding: var(--boxel-sp-xxxs);
        }
        :global(.card-display-name) {
          display: none;
        }
      }
      /* Double Strip (250 x 65) */
      /* Triple Strip (250 x 105) */
      /* Double Wide Strip (400 x 65) */
      /* Triple Wide Strip (400 x 105) */

      /* Horizontal Tiles */
      /* Regular Tile (250 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
        :global(.thumbnail-section) {
          height: 40%;
        }
        :global(.card-title) {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }
      }

      /* Horizontal Cards */
      /* Compact Card (400 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        :global(.thumbnail-section) {
          height: 100%;
        }
      }
      /* Full Card (400 x 275) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        :global(.fitted-template) {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        :global(.thumbnail-section) {
          max-width: 44%;
        }
        :global(.card-title) {
          font-size: var(--boxel-font-size-med);
        }
      }
    }
  </style>
</template>;

export default BasicFitted;
