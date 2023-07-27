import Component from '@glimmer/component';
import { service } from '@ember/service';
import { cssURL } from '@cardstack/boxel-ui/helpers/css-url';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import type { CardContext } from 'https://cardstack.com/base/card-api';
import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

interface Signature {
  Args: {
    title: string | null;
    description: string | null;
    thumbnailURL: string | null;
    context?: CardContext;
  };
}

export default class CardCatalogItem extends Component<Signature> {
  <template>
    <div class='catalog-item'>
      <div
        class='catalog-item__thumbnail'
        style={{if
          this.thumbnailURL
          (cssURL 'background-image' this.thumbnailURL)
        }}
      />
      <div>
        <header class='catalog-item__title'>
          {{@title}}
        </header>
        <p class='catalog-item__description' data-test-description>
          {{@description}}
        </p>
      </div>
    </div>

    <style>
      .catalog-item {
        --catalog-item-thumbnail-size: 2.5rem;
        display: grid;
        grid-template-columns: var(--catalog-item-thumbnail-size) 1fr;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
      }
      .catalog-item__thumbnail {
        width: var(--catalog-item-thumbnail-size);
        height: var(--catalog-item-thumbnail-size);
        border: 1px solid var(--boxel-border-color);
        border-radius: 100px;
        background-size: contain;
        background-position: center;
      }
      .catalog-item__title {
        font: 700 var(--boxel-font-sm);
        color: var(--boxel-dark);
      }
      .catalog-item__description {
        margin: 0;
        font: var(--boxel-font-xs);
        color: var(--boxel-500);
      }

    </style>
  </template>

  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  get thumbnailURL() {
    let path = this.args.thumbnailURL;
    if (!path) {
      return null;
    }

    let realmPath = new RealmPaths(this.cardService.defaultURL.href);

    if (/^(\.\.\/)+/.test(path)) {
      let localPath = new URL(path, realmPath.url).pathname.replace(/^\//, '');
      return new URL(localPath, realmPath.url).href;
    }
    return new URL(path, realmPath.url).href;
  }
}
