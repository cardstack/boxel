// Pretui — AudioPlayer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { AudioPlayer } from './audio-player';
import type { MediaChrome } from './media-player';
import {
  SOURCING_TRACKS,
  SOURCING_TRANSCRIPT,
  TONE_ASSET,
  TONE_WAV,
} from '../media-examples';
import { CHROMES } from '../demo-media';

// ── AudioPlayer ──────────────────────────────────────────────────────────
class AudioPlayerUsage extends Component {
  chromes = CHROMES;
  tracks = SOURCING_TRACKS;
  transcript = SOURCING_TRANSCRIPT;
  src = TONE_WAV;
  cover = TONE_ASSET.thumbnail;

  @tracked title = 'Lot B-1180 — desk note';
  @tracked artist = 'Sourcing desk · Kandy line';
  @tracked chrome = 'compact';

  setTitle = (v: string) => (this.title = v);
  setArtist = (v: string) => (this.artist = v);
  setChrome = (v: string) => (this.chrome = v);

  get chromeValue(): MediaChrome {
    return this.chrome as MediaChrome;
  }
  get usage(): string {
    return [
      '<AudioPlayer',
      '  @src={{this.src}}',
      `  @title='${this.title}'`,
      `  @artist='${this.artist}'`,
      '  @cover={{this.cover}}',
      '  @transcript={{this.transcript}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='AudioPlayer'
      @description="A skin over MediaPlayer, in the wrap-and-curry idiom Law 10 names — it curries @kind='audio' and adds the one thing a track needs that a video does not: a face. Cover art, title and artist are args, each with a slot escape hatch, and everything else is forwarded untouched. That is the whole component; there is no second transport, no second theme and no second keyboard map to keep in sync."
      @source={{this.usage}}
    >
      <:example>
        <AudioPlayer
          @src={{this.src}}
          @title={{this.title}}
          @artist={{this.artist}}
          @cover={{this.cover}}
          @chrome={{this.chromeValue}}
          @tracks={{this.tracks}}
          @transcript={{this.transcript}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='title'
          @value={{this.title}}
          @description='Track title. Also the default accessible name when @label is absent.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='artist'
          @value={{this.artist}}
          @description='Artist, show, or byline.'
          @onInput={{this.setArtist}}
        />
        <Args.String
          @name='cover'
          @value={{this.cover}}
          @description='Cover art URL. The plate on this page is a generated SVG, so the demo needs no network.'
          @hideControls={{true}}
        />
        <Args.String
          @name='coverAlt'
          @defaultValue=''
          @description='Alt text for the cover. Empty (the default) marks it decorative, which is right when the title beside it says the same thing — the alternative is a screen reader reading the album name twice.'
          @hideControls={{true}}
        />
        <Args.String
          @name='chrome'
          @value={{this.chrome}}
          @options={{this.chromes}}
          @defaultValue='full'
          @description='Forwarded to MediaPlayer.'
          @onInput={{this.setChrome}}
        />
        <Args.Yield
          @name='art'
          @description='Replaces the cover art entirely — a canvas, a waveform, an avatar stack.'
        />
        <Args.Yield
          @name='meta'
          @description='Replaces the title/artist stack.'
        />
        <Args.Yield @name='controls' @description='Forwarded to the bar.' />
        <Args.Yield @name='footer' @description='Forwarded to the footer.' />
        <Args.Base
          @name='everything else'
          @description='src, label, tracks, transcript, transcriptOpen, captionsDefault, seekOffset, loop, muted, preload, crossOrigin, quietStatus and onSnapshot are all forwarded to MediaPlayer verbatim. The kind, poster and aspectRatio args are removed from the signature rather than ignored, because a skin that accepts an arg it cannot honour is a lie.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_AUDIO_PLAYER: Record<string, unknown> = {
  AudioPlayer: AudioPlayerUsage,
};
