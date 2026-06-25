import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { isCardErrorJSONAPI } from '@cardstack/runtime-common';
import type { BfmSizeSpec } from '@cardstack/runtime-common/bfm-card-references';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import MarkdownEmbedPreview from './index';

type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';

export default class MarkdownEmbedPreviewUsage extends Component {
  @service declare private store: StoreService;

  @tracked private target: CardDef | undefined;

  // Args panel state — bound to <:api> so the freestyle UI drives the live
  // example below.
  @tracked private format: EmbedFormat = 'embedded';
  @tracked private kind: 'inline' | 'block' = 'block';
  @tracked private showSurroundingText = false;
  @tracked private fittedWidth = 150;
  @tracked private fittedHeight = 275;

  private get sizeSpec(): BfmSizeSpec {
    return {
      format: 'fitted',
      width: this.fittedWidth,
      height: this.fittedHeight,
    };
  }

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
          <div class='live'>
            <MarkdownEmbedPreview
              @target={{this.target}}
              @format={{this.format}}
              @kind={{this.kind}}
              @sizeSpec={{this.sizeSpec}}
              @showSurroundingText={{this.showSurroundingText}}
            />
          </div>
          <details class='gallery-toggle'>
            <summary>All formats at a glance</summary>
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
          </details>
        {{else}}
          <p class='hint'>Pick a card above to preview it.</p>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='target'
          @description='Resolved CardDef or FileDef to render. The caller loads it; this component renders only.'
          @required={{true}}
          @value={{this.target}}
        />
        <Args.String
          @name='format'
          @description="One of 'atom' | 'embedded' | 'fitted' | 'isolated'."
          @required={{true}}
          @value={{this.format}}
          @onInput={{fn (mut this.format)}}
          @options={{this.formatOptions}}
        />
        <Args.Object
          @name='sizeSpec'
          @description='BfmSizeSpec supplying width/height for fitted renders. Drive width/height with the inputs below.'
          @value={{this.sizeSpec}}
        />
        <Args.Number
          @name='sizeSpec.width'
          @description='Width in px when @format is fitted.'
          @value={{this.fittedWidth}}
          @onInput={{fn (mut this.fittedWidth)}}
        />
        <Args.Number
          @name='sizeSpec.height'
          @description='Height in px when @format is fitted.'
          @value={{this.fittedHeight}}
          @onInput={{fn (mut this.fittedHeight)}}
        />
        <Args.String
          @name='kind'
          @description="Placement: 'inline' (<span>) or 'block' (<div>). Default 'block'."
          @value={{this.kind}}
          @onInput={{fn (mut this.kind)}}
          @options={{this.kindOptions}}
        />
        <Args.Bool
          @name='showSurroundingText'
          @description='When true, wraps the embed in skeleton document text to preview how it sits in a real markdown doc. Default false.'
          @value={{this.showSurroundingText}}
          @onInput={{fn (mut this.showSurroundingText)}}
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
      .live {
        margin-top: var(--boxel-sp);
        padding: var(--boxel-sp);
        border: 1px dashed var(--boxel-300);
        border-radius: var(--boxel-border-radius);
      }
      .gallery-toggle {
        margin-top: var(--boxel-sp);
      }
      .gallery-toggle summary {
        cursor: pointer;
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        margin-bottom: var(--boxel-sp-xs);
      }
      .gallery {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
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
  private formatOptions = ['atom', 'embedded', 'fitted', 'isolated'];
  private kindOptions = ['inline', 'block'];
}
