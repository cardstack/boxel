import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { isCardErrorJSONAPI } from '@cardstack/runtime-common';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import MarkdownEmbedPreview from './index';

export default class MarkdownEmbedPreviewUsage extends Component {
  @service declare private store: StoreService;

  @tracked private target: CardDef | undefined;

  @action private async onSelect(url: string) {
    let result = await this.store.get(url);
    if (!isCardErrorJSONAPI(result)) {
      this.target = result as CardDef;
    }
  }

  <template>
    <FreestyleUsage @name='MarkdownEmbedChooser::Preview'>
      <:description>
        Pure render component for a markdown embed: given a resolved card/file,
        a format, and (for Fitted) a size, it renders the instance exactly as
        the live markdown renderer would. Cards and files share the same
        <code>CardRenderer</code>
        path.
        <code>@kind</code>
        only controls placement (inline-flow vs. block), not the render format.
      </:description>
      <:example>
        <div class='picker'>
          <MiniCardChooser @onSelect={{this.onSelect}} />
        </div>
        {{#if this.target}}
          <div class='gallery'>
            <figure>
              <figcaption>atom</figcaption>
              <MarkdownEmbedPreview @target={{this.target}} @format='atom' />
            </figure>
            <figure>
              <figcaption>embedded</figcaption>
              <MarkdownEmbedPreview
                @target={{this.target}}
                @format='embedded'
              />
            </figure>
            <figure>
              <figcaption>fitted — tall-tile (150×275)</figcaption>
              <MarkdownEmbedPreview
                @target={{this.target}}
                @format='fitted'
                @sizeSpec={{this.tallTile}}
              />
            </figure>
            <figure>
              <figcaption>fitted — custom 300×200</figcaption>
              <MarkdownEmbedPreview
                @target={{this.target}}
                @format='fitted'
                @sizeSpec={{this.custom}}
              />
            </figure>
          </div>
        {{else}}
          <p class='hint'>Pick a card above to preview it.</p>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='target'
          @description='Resolved CardDef or FileDef to render. The caller loads it; this component renders only.'
          @required={{true}}
        />
        <Args.String
          @name='format'
          @description="One of 'atom' | 'embedded' | 'fitted' | 'isolated'."
          @required={{true}}
        />
        <Args.Object
          @name='sizeSpec'
          @description='BfmSizeSpec supplying width/height for fitted renders.'
        />
        <Args.String
          @name='kind'
          @description="Placement: 'inline' (<span>) or 'block' (<div>). Default 'block'."
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .picker {
        width: 360px;
        height: 360px;
        border: 1px solid var(--boxel-border-color, var(--boxel-300));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .gallery {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp);
      }
      .gallery figcaption {
        margin-bottom: var(--boxel-sp-xxs);
        font: var(--boxel-font-xs);
        color: var(--boxel-450);
      }
      .hint {
        margin-top: var(--boxel-sp-xs);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
      }
    </style>
  </template>

  private tallTile = { format: 'fitted', width: 150, height: 275 } as const;
  private custom = { format: 'fitted', width: 300, height: 200 } as const;
}
