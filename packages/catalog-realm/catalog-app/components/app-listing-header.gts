import { on } from '@ember/modifier';

import GlimmerComponent from '@glimmer/component';
import ImageIcon from '@cardstack/boxel-icons/image';

import { BoxelButton } from '@cardstack/boxel-ui/components';

interface AppListingHeaderArgs {
  Args: {
    thumbnailUrl?: string;
    name: string;
    publisher: string;
    rating?: string; // TODO: add rating
    reviewCount?: string; // TODO: add review count
    buttonText: string;
    onButtonClick: () => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class AppListingHeader extends GlimmerComponent<AppListingHeaderArgs> {
  <template>
    <header class='app-listing-header' ...attributes>
      <div class='app-listing-header-content'>
        <div class='app-listing-header-logo-container'>
          <div class='thumbnail'>
            {{#if @thumbnailUrl}}
              <img
                src={{@thumbnailUrl}}
                alt={{@name}}
                class='app-listing-header-logo'
              />
            {{else}}
              <div class='default-icon-container'>
                <ImageIcon width='24' height='24' />
              </div>
            {{/if}}
          </div>

          <div class='app-info'>
            <h1 class='app-name'>{{@name}}</h1>
            <p class='publisher'>By {{@publisher}}</p>
            {{! Todo: add rating and review count }}
          </div>
        </div>

        <BoxelButton class='action-button' {{on 'click' @onButtonClick}}>
          {{@buttonText}}
        </BoxelButton>
      </div>
    </header>

    <style scoped>
      @layer {
        /* container */
        .app-listing-header {
          --app-listing-thumbnail-size: 60px;
          padding: var(--boxel-sp-sm);
          background-color: var(--boxel-light);
          border-radius: var(--boxel-border-radius);
          box-shadow: var(--boxel-box-shadow-sm);
          container-name: app-listing-header-container;
          container-type: inline-size;
        }
        .app-listing-header-content {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: var(--boxel-sp);
        }
        .thumbnail {
          flex-shrink: 0;
        }
        .app-listing-header-logo-container {
          display: flex;
          align-items: start;
          gap: var(--boxel-sp);
        }
        .app-listing-header-logo {
          width: var(--app-listing-thumbnail-size);
          height: var(--app-listing-thumbnail-size);
          object-fit: cover;
          border-radius: var(--boxel-border-radius-sm);
        }
        .default-icon-container {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--app-listing-thumbnail-size);
          height: var(--app-listing-thumbnail-size);
          background-color: var(--boxel-200);
          color: var(--boxel-400);
          border-radius: var(--boxel-border-radius-sm);
          padding: 5px;
        }
        .app-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
          min-width: 0;
        }
        .app-name {
          margin: 0;
          font: 700 var(--boxel-font-lg);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .publisher {
          margin: 0;
          font: 400 var(--boxel-font-sm);
          color: var(--boxel-gray);
        }
        .action-button {
          --boxel-button-color: var(--boxel-dark);
          --boxel-button-text-color: var(--boxel-light);
        }
        .action-button:hover {
          --boxel-button-background-color: var(--boxel-800);
        }

        @container app-listing-header-container (inline-size <= 500px) {
          .app-listing-header-content {
            flex-direction: column;
            align-items: flex-start;
          }
          .action-button {
            width: 100%;
            margin-top: var(--boxel-sp-xs);
          }
        }
      }
    </style>
  </template>
}
