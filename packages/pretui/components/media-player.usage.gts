// Pretui — MediaPlayer usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { MediaPlayer } from './media-player';
import type { MediaChrome, MediaSnapshot } from './media-player';
import {
  SAMPLE_VIDEO_POSTER,
  SAMPLE_VIDEO_SRC,
  SOURCING_TRACKS,
  SOURCING_TRANSCRIPT,
  TONE_WAV,
} from '../media-examples';
import { Token } from './token';
import { CHROMES } from '../demo-media';

// ── MediaPlayer ──────────────────────────────────────────────────────────
const KINDS: string[] = ['audio', 'video'];

class MediaPlayerUsage extends Component {
  chromes = CHROMES;
  kinds = KINDS;
  tracks = SOURCING_TRACKS;
  transcript = SOURCING_TRANSCRIPT;

  @tracked kind = 'audio';
  @tracked chrome = 'full';
  @tracked autoHide = false;
  @tracked transcriptOpen = true;
  @tracked quietStatus = false;
  @tracked captionsDefault = false;
  @tracked seekOffset = 10;
  @tracked lastPhase = 'idle';

  setKind = (v: string) => (this.kind = v);
  setChrome = (v: string) => (this.chrome = v);
  setAutoHide = (v: boolean) => (this.autoHide = v);
  setTranscriptOpen = (v: boolean) => (this.transcriptOpen = v);
  setQuietStatus = (v: boolean) => (this.quietStatus = v);
  setCaptionsDefault = (v: boolean) => (this.captionsDefault = v);
  setSeekOffset = (v: number | null) => (this.seekOffset = v ?? 10);
  noteSnapshot = (snapshot: MediaSnapshot) => (this.lastPhase = snapshot.phase);

  get kindValue(): 'audio' | 'video' {
    return this.kind === 'video' ? 'video' : 'audio';
  }
  get chromeValue(): MediaChrome {
    return this.chrome as MediaChrome;
  }
  get src(): string {
    return this.kindValue === 'video' ? SAMPLE_VIDEO_SRC : TONE_WAV;
  }
  get poster(): string | undefined {
    return this.kindValue === 'video' ? SAMPLE_VIDEO_POSTER : undefined;
  }
  get label(): string {
    return this.kindValue === 'video'
      ? 'Estate reel — second flush'
      : 'Lot B-1180 — desk note';
  }
  get usage(): string {
    return [
      '<MediaPlayer',
      `  @kind='${this.kindValue}'`,
      "  @src={{this.src}}",
      `  @label='${this.label}'`,
      `  @chrome='${this.chrome}'`,
      '  @tracks={{this.tracks}}',
      '  @transcript={{this.transcript}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='MediaPlayer'
      @description="One transport contract for audio and video, built on Media Chrome (MIT, vendored at ./media-chrome). Everything here plays offline: the audio is six seconds of PCM synthesised as a speech-shaped desk note, and its captions are a WebVTT data URL compiled from the very cue list the transcript below renders — so the browser's caption channel and ours cannot drift apart. Try the keyboard before anything else: click the picture, then Space, ←, →, ↑, ↓, m, c, f, and Shift+/ for the shortcut sheet. Then set autoHide on, Tab into the controls, and watch them come back — Media Chrome's own default leaves them focusable and invisible, which is the one behaviour on this page that had to be inverted rather than themed."
      @source={{this.usage}}
    >
      <:example>
        <MediaPlayer
          @kind={{this.kindValue}}
          @src={{this.src}}
          @label={{this.label}}
          @poster={{this.poster}}
          @chrome={{this.chromeValue}}
          @autoHide={{this.autoHide}}
          @tracks={{this.tracks}}
          @transcript={{this.transcript}}
          @transcriptOpen={{this.transcriptOpen}}
          @captionsDefault={{this.captionsDefault}}
          @quietStatus={{this.quietStatus}}
          @seekOffset={{this.seekOffset}}
          @onSnapshot={{this.noteSnapshot}}
        />
        <p class='mp-readout'>
          <span class='mp-readoutLabel'>@onSnapshot phase</span>
          <Token @value={{this.lastPhase}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='kind'
          @value={{this.kind}}
          @options={{this.kinds}}
          @defaultValue='video'
          @description="'video' (default) or 'audio'. Audio mode lays the transport out in normal flow instead of over a picture, drops the fullscreen and picture-in-picture controls, and re-points the ink token at the page foreground — one custom-property flip, not a second theme. NOTE: switching to video here loads a public test clip over the network; offline it lands on the error channel, which is itself worth seeing."
          @onInput={{this.setKind}}
        />
        <Args.String
          @name='src'
          @value={{this.src}}
          @description='URL of the media. Passed through untouched — this component never creates or revokes an object URL, so a blob URL stays yours to revoke.'
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @description='Accessible name for the player region. An unnamed media region is a dead end for anyone moving by landmark.'
          @hideControls={{true}}
        />
        <Args.String
          @name='chrome'
          @value={{this.chrome}}
          @options={{this.chromes}}
          @defaultValue='full'
          @description="How much transport to wear: 'full', 'compact' (no skip buttons, no rate), 'minimal' (play + scrubber), 'none' (an empty bar for the <:controls> block to fill). Four named steps rather than nine booleans — anything finer is @chrome='none' plus the block."
          @onInput={{this.setChrome}}
        />
        <Args.Bool
          @name='autoHide'
          @value={{this.autoHide}}
          @defaultValue={{false}}
          @description="Let the controls fade during playback. Media Chrome's own default is ON; Pretui inverts it, because a focusable invisible control is worse than no control. When you do opt in, focus brings the bar straight back — an outer-tree rule beats the shadow root's ::slotted() rules on a slotted child, so no !important and no :deep() is involved."
          @onInput={{this.setAutoHide}}
        />
        <Args.Object
          @name='tracks'
          @value={{this.tracks}}
          @description='Text tracks: { src, label, srclang, kind?, isDefault? }[]. `isDefault` rather than `default` because the boolean must bind as a property, not a string. Captions and subtitles get a captions button; descriptions and chapters ride along for the browser. No tracks ⇒ no captions button at all, rather than a dead one.'
        />
        <Args.Object
          @name='transcript'
          @value={{this.transcript}}
          @description='{ start, end, text, speaker? }[] — a real, seekable transcript, rendered in a native <details>. Click any line to seek. The cue holding the playhead carries aria-current plus a weight change and an inline-start rule, so it survives greyscale. Supplying a transcript is also what subscribes the player to `timeupdate`; with no transcript there is nothing on screen that moves with the playhead, so nothing subscribes.'
        />
        <Args.Bool
          @name='transcriptOpen'
          @value={{this.transcriptOpen}}
          @defaultValue={{false}}
          @description='Open the transcript disclosure on first paint.'
          @onInput={{this.setTranscriptOpen}}
        />
        <Args.Bool
          @name='captionsDefault'
          @value={{this.captionsDefault}}
          @defaultValue={{false}}
          @description='Turn on the first subtitles track without the reader asking. Off by default: captions are a reader preference, and Media Chrome already remembers the last choice.'
          @onInput={{this.setCaptionsDefault}}
        />
        <Args.Number
          @name='seekOffset'
          @value={{this.seekOffset}}
          @defaultValue={{10}}
          @min={{1}}
          @max={{60}}
          @description='Seconds for the skip buttons and the ←/→ hotkeys. Seek by PAGE needs no argument: focus the scrubber and PageUp/PageDown move by a large step, because it is a native <input type=range> underneath.'
          @onInput={{this.setSeekOffset}}
        />
        <Args.Bool
          @name='quietStatus'
          @value={{this.quietStatus}}
          @defaultValue={{false}}
          @description='Hide the status line under the transport. That line is the TEXT channel for buffering, ended and error — state is never colour alone here — so silence it only when the host shows the same thing elsewhere. The polite live region is separate and always present; it speaks only on failure.'
          @onInput={{this.setQuietStatus}}
        />
        <Args.String
          @name='poster'
          @description='Poster image for video. Together with @aspectRatio it is what makes the reserved space useful rather than merely blank.'
          @hideControls={{true}}
        />
        <Args.String
          @name='aspectRatio'
          @defaultValue='16 / 9'
          @description='CSS aspect-ratio for the stage, reserved from the first paint so nothing reflows when the poster resolves. Filtered to digits, dot, slash and space before it reaches the custom property.'
          @hideControls={{true}}
        />
        <Args.String
          @name='thumbnails'
          @description='URL of a WebVTT thumbnails track (video only). Present ⇒ the scrubber shows a preview image while seeking.'
          @hideControls={{true}}
        />
        <Args.String
          @name='crossOrigin'
          @description="'anonymous' | 'use-credentials'. Cross-origin <track> files need this or the browser drops them silently."
          @hideControls={{true}}
        />
        <Args.String
          @name='preload'
          @defaultValue='metadata'
          @description="'none' | 'metadata' | 'auto'. There is no @autoplay arg, and there will not be one."
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSnapshot'
          @description='(snapshot) => void on every media event: { phase, currentTime, duration, errorMessage }. Event-driven, never polled — no rAF loop and no timer anywhere in this component. The readout under the player is this callback.'
        />
        <Args.Yield
          @name='overlay'
          @description='Floats over the picture, top-left — a live pill, a rights badge. Pointer-transparent by default so it never steals a click; set pointer-events: auto on your own control.'
        />
        <Args.Yield
          @name='controls'
          @description="Appended INSIDE the control bar, just before fullscreen. Combine with @chrome='none' to own the bar completely."
        />
        <Args.Yield
          @name='footer'
          @description='Under the transport, above the transcript.'
        />
      </:api>

      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-media-aspect'
          @type='ratio'
          @description='The reserved stage ratio. Set through @aspectRatio; restyle here when a wrapper wants to override.'
        />
        <Css.Basic
          @name='pretui-media-ink'
          @type='color'
          @description='The transport ink. Defaults to --card over a picture and --foreground in audio mode, which is the whole of the light/dark story — there is no dark branch in this component.'
        />
        <Css.Basic
          @name='pretui-media-scrim'
          @type='color'
          @description='The gradient under the video transport, so the controls stay legible over a bright frame.'
        />
        <Css.Basic
          @name='pretui-media-radius'
          @type='length'
          @description='Corner radius of the stage.'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .mp-readout {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .mp-readoutLabel {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_MEDIA_PLAYER: Record<string, unknown> = {
  MediaPlayer: MediaPlayerUsage,
};
