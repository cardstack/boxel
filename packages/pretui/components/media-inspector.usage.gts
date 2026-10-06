// Pretui — MediaInspector usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { MediaInspector } from './media-inspector';
import { SAMPLE_ASSETS } from '../media-examples';

// ── MediaInspector ───────────────────────────────────────────────────────
class MediaInspectorUsage extends Component {
  names: string[] = SAMPLE_ASSETS.map((asset) => asset.name ?? asset.src);

  @tracked choice = SAMPLE_ASSETS[0].name ?? '';
  @tracked metaOnly = false;
  @tracked title = 'Details';

  setChoice = (v: string) => (this.choice = v);
  setMetaOnly = (v: boolean) => (this.metaOnly = v);
  setTitle = (v: string) => (this.title = v);

  get asset(): MediaAssetSpec {
    return (
      SAMPLE_ASSETS.find((candidate) => candidate.name === this.choice) ??
      SAMPLE_ASSETS[0]
    );
  }
  get usage(): string {
    return `<MediaInspector @asset={{this.asset}} @title='${this.title}' />`;
  }

  <template>
    <FreestyleUsage
      @name='MediaInspector'
      @description="The metadata panel. It composes KeyValue rather than growing a second definition list — the only thing it adds is the derived row set, computed from the asset exactly the way AssetGrid computes the same numbers, so the panel and the tile can never disagree. Machine values (dimensions, size, duration, format) get the Law-3 mono token; prose does not."
      @source={{this.usage}}
    >
      <:example>
        <MediaInspector
          @asset={{this.asset}}
          @title={{this.title}}
          @metaOnly={{this.metaOnly}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='asset (demo knob)'
          @value={{this.choice}}
          @options={{this.names}}
          @description='Which asset to describe.'
          @onInput={{this.setChoice}}
        />
        <Args.Object
          @name='asset'
          @value={{this.asset}}
          @description='The same MediaAssetSpec the viewer and the grid take.'
        />
        <Args.String
          @name='title'
          @value={{this.title}}
          @defaultValue='Details'
          @description='Heading above the rows, and the accessible name of the section.'
          @onInput={{this.setTitle}}
        />
        <Args.Bool
          @name='metaOnly'
          @value={{this.metaOnly}}
          @defaultValue={{false}}
          @description='Drop the derived rows (kind, dimensions, duration, size, captions) and show only asset.meta.'
          @onInput={{this.setMetaOnly}}
        />
        <Args.Yield
          @name='footer'
          @description='Extra rows or controls under the table.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_MEDIA_INSPECTOR: Record<string, unknown> = {
  MediaInspector: MediaInspectorUsage,
};
