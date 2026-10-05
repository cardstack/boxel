// Pretui — VideoPlayer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { VideoPlayer } from './video-player';
import {
  SAMPLE_VIDEO_POSTER,
  SAMPLE_VIDEO_SRC,
  SOURCING_TRACKS,
  SOURCING_TRANSCRIPT,
} from '../media-examples';
import { Chip } from './chip';
import { CHROMES } from '../demo-media';

// ── VideoPlayer ──────────────────────────────────────────────────────────
const RATIOS: string[] = ['16 / 9', '4 / 3', '1 / 1', '21 / 9'];

class VideoPlayerUsage extends Component {
  ratios = RATIOS;
  chromes = CHROMES;
  tracks = SOURCING_TRACKS;
  transcript = SOURCING_TRANSCRIPT;
  src = SAMPLE_VIDEO_SRC;
  poster = SAMPLE_VIDEO_POSTER;

  @tracked aspectRatio = '16 / 9';
  @tracked autoHide = true;
  @tracked caption =
    'Second flush arriving at the Kandy shed. Public test clip, used here as a stand-in.';

  setAspectRatio = (v: string) => (this.aspectRatio = v);
  setAutoHide = (v: boolean) => (this.autoHide = v);
  setCaption = (v: string) => (this.caption = v);

  get usage(): string {
    return [
      '<VideoPlayer',
      '  @src={{this.src}}',
      '  @poster={{this.poster}}',
      `  @aspectRatio='${this.aspectRatio}'`,
      `  @autoHide={{${this.autoHide}}}`,
      '  @tracks={{this.tracks}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='VideoPlayer'
      @description="The other skin: @kind='video' curried, a reserved aspect ratio, a poster, and a <figcaption> so the picture and its caption are one figure to assistive technology. This is the one page on the site that needs a network — there is no way to synthesise an mp4 — so the src points at the public test clip Media Chrome's own documentation uses, and it is a knob. Offline you get the poster, the reserved box and the error text, which is exactly what the error channel is for. Note autoHide is ON here, against the kit default: press Tab and the bar returns."
      @source={{this.usage}}
    >
      <:example>
        <VideoPlayer
          @src={{this.src}}
          @label='Estate reel — second flush'
          @poster={{this.poster}}
          @aspectRatio={{this.aspectRatio}}
          @autoHide={{this.autoHide}}
          @caption={{this.caption}}
          @tracks={{this.tracks}}
          @transcript={{this.transcript}}
        >
          <:overlay>
            <Chip>Rights: internal</Chip>
          </:overlay>
        </VideoPlayer>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='aspectRatio'
          @value={{this.aspectRatio}}
          @options={{this.ratios}}
          @defaultValue='16 / 9'
          @description='Reserved before the poster resolves, so nothing reflows. Switch it and watch the box change without a flash of collapsed layout — the defect the catalog sweep found three separate times.'
          @onInput={{this.setAspectRatio}}
        />
        <Args.Bool
          @name='autoHide'
          @value={{this.autoHide}}
          @defaultValue={{false}}
          @description='Cinema behaviour. Focus always brings the transport back.'
          @onInput={{this.setAutoHide}}
        />
        <Args.String
          @name='caption'
          @value={{this.caption}}
          @description='Rendered as a <figcaption> inside a <figure>, which is the semantic pairing — not a paragraph that happens to sit underneath.'
          @onInput={{this.setCaption}}
        />
        <Args.Yield
          @name='overlay'
          @description='Over the picture, top-left. The rights chip above is this block.'
        />
        <Args.Base
          @name='everything else'
          @description='Every MediaPlayer arg except @kind is forwarded verbatim, including @thumbnails — supply a WebVTT thumbnails track and the scrubber shows preview frames while seeking.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_VIDEO_PLAYER: Record<string, unknown> = {
  VideoPlayer: VideoPlayerUsage,
};
