// Pretui — MediaViewer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { MediaViewer } from './media-viewer';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { SAMPLE_ASSETS } from '../media-examples';

// ── MediaViewer ──────────────────────────────────────────────────────────
class MediaViewerUsage extends Component {
  assets = SAMPLE_ASSETS;
  names: string[] = SAMPLE_ASSETS.map((asset) => asset.name ?? asset.src);

  @tracked choice = SAMPLE_ASSETS[0].name ?? '';

  setChoice = (v: string) => (this.choice = v);

  get asset(): MediaAssetSpec {
    return (
      SAMPLE_ASSETS.find((candidate) => candidate.name === this.choice) ??
      SAMPLE_ASSETS[0]
    );
  }
  get usage(): string {
    return '<MediaViewer @asset={{this.asset}} />';
  }

  <template>
    <FreestyleUsage
      @name='MediaViewer'
      @description="The adapter shell (Appendix M.6): one signature, N adapters, selected by asset kind. Pick a different asset and a different viewer runs — image, audio, video — without the caller knowing what it is holding. Then pick the .glb and read the fallback: it names the kind, names the component that would open it, and offers the file. That is the point of the shell. Kind detection is data in one place (explicit kind, then MIME type — including the one inside a data: URL — then an extension table), and the registry is open and last-write-wins, so a consumer overrides a built-in by registering after this module loads. Adding PDF, SVG, font or CAD later is a registration, not a rewrite."
      @source={{this.usage}}
    >
      <:example>
        <MediaViewer @asset={{this.asset}} />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='asset (demo knob)'
          @value={{this.choice}}
          @options={{this.names}}
          @description='The asset handed to the shell. Eight assets across four kinds, one of which (model/gltf-binary) deliberately has no adapter yet.'
          @onInput={{this.setChoice}}
        />
        <Args.Object
          @name='asset'
          @value={{this.asset}}
          @description='{ src, name?, kind?, mimeType?, poster?, thumbnail?, alt?, tracks?, transcript?, width?, height?, duration?, bytes?, meta? }. Only src is required. The shell resolves it once — kind, display label and aspect ratio — and hands the RESOLVED asset to the adapter, so no adapter re-derives any of it.'
        />
        <Args.Yield
          @name='unsupported'
          @description='Replaces the built-in fallback for an unrouted asset. The built-in is deliberately loud: silence here is how a gallery ends up showing a blank box for a file type nobody noticed was missing.'
        />
        <Args.Base
          @name='registerMediaAdapter(adapter)'
          @description='{ id, label, handles(asset), component }. Unshifts, so the most recently registered adapter that claims an asset wins. Matching is by predicate rather than by kind, so an adapter can claim a subset — "images over 20 MP", "audio that has a transcript". mediaAdapters() lists them; adapterFor(asset) resolves one.'
        />
        <Args.Base
          @name='kindForAsset(asset)'
          @description="Exported. 'image' | 'video' | 'audio' | 'model' | 'unknown'. Deterministic and offline — no HEAD request, which would be a lie in a realm where every asset sits behind header auth."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_MEDIA_VIEWER: Record<string, unknown> = {
  MediaViewer: MediaViewerUsage,
};
