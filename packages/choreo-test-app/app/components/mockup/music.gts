import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';

/**
 * The Music app for the phone mockup — a real, tappable player inside the
 * 390 x 844 screen. Hue 275 is the app's identity, so every surface here is
 * some value of purple.
 *
 * The choreography rule this component is built around: <Choreo>'s render
 * detector is VOLATILE, so the 250 ms progress tick re-passes the region four
 * times a second. Every step below therefore selects CHANGE — inserted,
 * removed, moved — and never a bare `c.id`. A step that always matched would
 * compile a cue on every tick and the art would strobe. With change-only
 * queries a tick compiles nothing, the region takes its empty-score bail, and
 * the timeline plays only when the user actually does something.
 *
 * That is also why the album art is an {{#each}} of one: keying the plate by
 * track id makes a track change a real remove/insert pair, which is the
 * crossfade. Play/pause swaps the transport icon and mounts a glow ring over
 * the art, so the pulse rides the same mechanism.
 */

interface Track {
  /** the gradient class suffix — shared by the big plate and the queue swatch */
  art: string;
  artist: string;
  duration: number;
  id: string;
  title: string;
}

const TRACKS: Track[] = [
  {
    art: 'aurora',
    artist: 'Nocturne Atlas',
    duration: 214,
    id: 'violet-hour',
    title: 'Violet Hour',
  },
  {
    art: 'ember',
    artist: 'Kite & Compass',
    duration: 189,
    id: 'paper-lanterns',
    title: 'Paper Lanterns',
  },
  {
    art: 'tide',
    artist: 'Sable Mirrors',
    duration: 243,
    id: 'low-orbit',
    title: 'Low Orbit',
  },
  {
    art: 'dusk',
    artist: 'Harbor Static',
    duration: 201,
    id: 'slow-cassette',
    title: 'Slow Cassette',
  },
];

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** ms between progress ticks */
const TICK = 250;

/** the queue reflow: firm, no overshoot worth speaking of */
const glide = { damping: 26, stiffness: 300 };

function clock(total: number): string {
  const whole = Math.max(0, Math.round(total));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export class MusicApp extends Component {
  @tracked elapsed = 0;
  @tracked index = 0;
  @tracked isPlaying = false;
  @tracked volume = 7;

  private timer?: ReturnType<typeof setInterval>;

  get current(): Track {
    return TRACKS[this.index]!;
  }

  /** one item, keyed by track — so a track change is a remove/insert pair */
  get artLayers(): Track[] {
    return [this.current];
  }

  get elapsedLabel(): string {
    return clock(this.elapsed);
  }

  get percent(): string {
    const ratio = this.elapsed / this.current.duration;
    return String(Math.min(100, Math.max(0, ratio * 100)));
  }

  get queue(): Track[] {
    return [1, 2, 3].map(
      (offset) => TRACKS[(this.index + offset) % TRACKS.length]!
    );
  }

  get remainingLabel(): string {
    return `-${clock(this.current.duration - this.elapsed)}`;
  }

  get volumeSteps(): { level: number; on: boolean }[] {
    return LEVELS.map((level) => ({ level, on: level <= this.volume }));
  }

  togglePlay = () => {
    if (this.isPlaying) {
      this.isPlaying = false;
      this.clearTimer();
    } else {
      this.isPlaying = true;
      if (this.timer === undefined) {
        this.timer = setInterval(this.tick, TICK);
      }
    }
  };

  next = () => {
    this.step(1);
  };

  prev = () => {
    this.step(-1);
  };

  select = (track: Track) => {
    this.index = TRACKS.indexOf(track);
    this.elapsed = 0;
  };

  setVolume = (level: number) => {
    this.volume = level;
  };

  override willDestroy(): void {
    super.willDestroy();
    this.clearTimer();
  }

  private tick = () => {
    const ahead = this.elapsed + TICK / 1000;
    if (ahead >= this.current.duration) {
      this.step(1);
    } else {
      this.elapsed = ahead;
    }
  };

  private step(delta: number) {
    const count = TRACKS.length;
    this.index = (this.index + delta + count) % count;
    this.elapsed = 0;
  }

  private clearTimer() {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  <template>
    <div class="music-app">
      <Choreo class="music-stage" as |c|>

        <div class="music-topbar">
          <button type="button" class="music-chip" aria-label="Close">
            <svg class="music-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 9.5 12 15.5 18 9.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <span class="music-topbar-label">Playing from Nightlines</span>
          <button type="button" class="music-chip" aria-label="More">
            <svg class="music-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5.5" r="1.7" fill="currentColor" />
              <circle cx="12" cy="12" r="1.7" fill="currentColor" />
              <circle cx="12" cy="18.5" r="1.7" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div class="music-art">
          {{#each this.artLayers key="id" as |layer|}}
            <span
              class="music-art-layer music-art--{{layer.art}}"
              {{motion id=layer.id role="art"}}
            ></span>
          {{/each}}
          {{#if this.isPlaying}}
            <span
              class="music-art-glow"
              {{motion id="glow" role="glow"}}
            ></span>
          {{/if}}
        </div>

        <div class="music-meta">
          <div class="music-title">{{this.current.title}}</div>
          <div class="music-artist">{{this.current.artist}}</div>
        </div>

        <div class="music-bar-row">
          <div class="music-bar">
            <svg
              class="music-bar-svg"
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect
                class="music-bar-fill"
                x="0"
                y="0"
                height="6"
                width={{this.percent}}
              />
            </svg>
          </div>
          <div class="music-times">
            <span>{{this.elapsedLabel}}</span>
            <span>{{this.remainingLabel}}</span>
          </div>
        </div>

        <div class="music-transport">
          <button
            type="button"
            class="music-key music-key--side"
            aria-label="Previous track"
            {{on "click" this.prev}}
          >
            <svg class="music-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 5.5v13L8.5 12z" fill="currentColor" />
              <path d="M4.5 5H7v14H4.5z" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            class="music-key music-key--play"
            aria-label={{if this.isPlaying "Pause" "Play"}}
            {{on "click" this.togglePlay}}
          >
            {{#if this.isPlaying}}
              <span
                class="music-icon-slot"
                {{motion id="icon-pause" role="icon"}}
              >
                <svg
                  class="music-glyph music-glyph--big"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M8 5h3.2v14H8z" fill="currentColor" />
                  <path d="M12.8 5H16v14h-3.2z" fill="currentColor" />
                </svg>
              </span>
            {{else}}
              <span
                class="music-icon-slot"
                {{motion id="icon-play" role="icon"}}
              >
                <svg
                  class="music-glyph music-glyph--big"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M8.5 5.2v13.6L19 12z" fill="currentColor" />
                </svg>
              </span>
            {{/if}}
          </button>

          <button
            type="button"
            class="music-key music-key--side"
            aria-label="Next track"
            {{on "click" this.next}}
          >
            <svg class="music-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 5.5v13L15.5 12z" fill="currentColor" />
              <path d="M17 5h2.5v14H17z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div class="music-volume">
          <span class="music-volume-cap">Vol</span>
          <div class="music-volume-track">
            {{#each this.volumeSteps key="level" as |stepValue|}}
              <button
                type="button"
                class={{if
                  stepValue.on
                  "music-volume-step music-volume-step--on"
                  "music-volume-step"
                }}
                aria-label="Volume {{stepValue.level}}"
                {{on "click" (fn this.setVolume stepValue.level)}}
              ></button>
            {{/each}}
          </div>
        </div>

        <div class="music-queue">
          <div class="music-queue-head">Up Next</div>
          {{#each this.queue key="id" as |track|}}
            <button
              type="button"
              class="music-queue-row"
              {{motion id=track.id role="queue"}}
              {{on "click" (fn this.select track)}}
            >
              <span class="music-queue-swatch music-art--{{track.art}}"></span>
              <span class="music-queue-text">
                <span class="music-queue-title">{{track.title}}</span>
                <span class="music-queue-artist">{{track.artist}}</span>
              </span>
              <span class="music-queue-time">{{clock track.duration}}</span>
            </button>
          {{/each}}
        </div>

        {{! Every query below selects CHANGE, so a progress tick — which moves
            nothing and mounts nothing — compiles an empty score and the region
            bails without touching the picture. }}
        <c.Parallel>
          {{! track change: the outgoing plate is held in the orphan layer while
              the incoming one fades up over it }}
          <c.Tween
            @of={{c.inserted "art"}}
            @opacity={{array 0 1}}
            @scale={{array 1.06 1}}
            @duration={{0.36}}
          />
          <c.Tween @of={{c.removed "art"}} @opacity={{0}} @duration={{0.28}} />

          {{! …and the queue reflows around it on one spring }}
          <c.Move @of={{c.moved "queue"}} @spring={{glide}} @size={{false}} />
          <c.Tween
            @of={{c.inserted "queue"}}
            @opacity={{array 0 1}}
            @duration={{0.26}}
            @delay={{0.06}}
          />
          <c.Tween
            @of={{c.removed "queue"}}
            @opacity={{0}}
            @duration={{0.18}}
          />

          {{! play/pause: the icon swaps and the ring over the art pulses }}
          <c.Tween
            @of={{c.inserted "icon"}}
            @opacity={{array 0 1}}
            @scale={{array 0.6 1}}
            @duration={{0.22}}
          />
          <c.Tween
            @of={{c.removed "icon"}}
            @opacity={{0}}
            @scale={{0.6}}
            @duration={{0.16}}
          />
          <c.Tween
            @of={{c.inserted "glow"}}
            @opacity={{array 0 1}}
            @scale={{array 1.05 1}}
            @duration={{0.34}}
          />
          <c.Tween
            @of={{c.removed "glow"}}
            @opacity={{0}}
            @scale={{1.05}}
            @duration={{0.26}}
          />
        </c.Parallel>
      </Choreo>

      <style>
        .music-app {
          position: absolute;
          inset: 0;
          overflow: hidden;
          user-select: none;
          -webkit-user-select: none;
          color: hsl(275 40% 96%);
          font-family:
            ui-sans-serif,
            system-ui,
            -apple-system,
            "Segoe UI",
            sans-serif;
          background:
            radial-gradient(
              120% 68% at 50% -12%,
              hsl(275 64% 32%) 0%,
              transparent 62%
            ),
            linear-gradient(180deg, hsl(275 44% 13%) 0%, hsl(275 48% 6%) 100%);
        }

        .music-stage {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          padding: 10px 22px 16px;
        }

        .music-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 44px;
          flex: 0 0 auto;
        }

        .music-topbar-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: hsl(275 30% 74%);
        }

        .music-chip {
          width: 34px;
          height: 34px;
          padding: 0;
          border: 0;
          border-radius: 11px;
          background: hsl(275 40% 100% / 0.08);
          color: hsl(275 30% 88%);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .music-glyph {
          width: 22px;
          height: 22px;
          display: block;
        }

        .music-glyph--big {
          width: 28px;
          height: 28px;
        }

        .music-art {
          position: relative;
          width: 312px;
          height: 312px;
          margin: 6px auto 0;
          flex: 0 0 auto;
          border-radius: 26px;
          box-shadow: 0 26px 48px -18px hsl(275 80% 3% / 0.9);
        }

        .music-art-layer {
          position: absolute;
          inset: 0;
          border-radius: 26px;
        }

        .music-art-glow {
          position: absolute;
          inset: 0;
          border-radius: 26px;
          box-shadow:
            inset 0 0 0 3px hsl(285 100% 90% / 0.5),
            0 0 46px hsl(288 92% 62% / 0.45);
        }

        .music-art--aurora {
          background:
            radial-gradient(
              80% 70% at 24% 18%,
              hsl(305 96% 78% / 0.95) 0%,
              transparent 62%
            ),
            linear-gradient(
              152deg,
              hsl(275 92% 68%) 0%,
              hsl(322 84% 52%) 46%,
              hsl(258 72% 18%) 100%
            );
        }

        .music-art--ember {
          background:
            radial-gradient(
              72% 62% at 74% 22%,
              hsl(34 98% 70% / 0.9) 0%,
              transparent 60%
            ),
            linear-gradient(
              138deg,
              hsl(348 88% 62%) 0%,
              hsl(288 76% 44%) 52%,
              hsl(272 68% 14%) 100%
            );
        }

        .music-art--tide {
          background:
            radial-gradient(
              86% 76% at 18% 80%,
              hsl(188 92% 62% / 0.85) 0%,
              transparent 62%
            ),
            linear-gradient(
              160deg,
              hsl(228 86% 66%) 0%,
              hsl(276 74% 44%) 50%,
              hsl(266 70% 12%) 100%
            );
        }

        .music-art--dusk {
          background:
            radial-gradient(
              70% 70% at 62% 30%,
              hsl(266 88% 74% / 0.9) 0%,
              transparent 64%
            ),
            linear-gradient(
              146deg,
              hsl(300 46% 58%) 0%,
              hsl(276 52% 30%) 48%,
              hsl(280 60% 10%) 100%
            );
        }

        .music-meta {
          margin-top: 20px;
          flex: 0 0 auto;
        }

        .music-title {
          font-size: 22px;
          font-weight: 600;
          line-height: 1.2;
          letter-spacing: -0.01em;
        }

        .music-artist {
          margin-top: 5px;
          font-size: 15px;
          color: hsl(275 32% 76%);
        }

        .music-bar-row {
          margin-top: 16px;
          flex: 0 0 auto;
        }

        .music-bar {
          height: 6px;
          border-radius: 3px;
          overflow: hidden;
          background: hsl(275 40% 100% / 0.15);
        }

        .music-bar-svg {
          display: block;
          width: 100%;
          height: 6px;
        }

        .music-bar-fill {
          fill: hsl(290 92% 74%);
        }

        .music-times {
          display: flex;
          justify-content: space-between;
          margin-top: 7px;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          color: hsl(275 26% 68%);
        }

        .music-transport {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 26px;
          margin-top: 14px;
          flex: 0 0 auto;
        }

        .music-key {
          padding: 0;
          border: 0;
          background: transparent;
          color: hsl(275 30% 94%);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .music-key--side {
          width: 50px;
          height: 50px;
        }

        .music-key--play {
          width: 62px;
          height: 62px;
          border-radius: 31px;
          color: hsl(276 62% 12%);
          background: linear-gradient(
            158deg,
            hsl(292 94% 78%) 0%,
            hsl(268 86% 58%) 100%
          );
          box-shadow: 0 12px 26px -10px hsl(286 92% 52% / 0.85);
        }

        .music-icon-slot {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .music-volume {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 16px;
          flex: 0 0 auto;
        }

        .music-volume-cap {
          width: 26px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: hsl(275 26% 66%);
        }

        .music-volume-track {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1 1 auto;
        }

        .music-volume-step {
          flex: 1 1 0;
          height: 8px;
          padding: 0;
          border: 0;
          border-radius: 4px;
          background: hsl(275 40% 100% / 0.15);
        }

        .music-volume-step--on {
          background: hsl(290 88% 74%);
        }

        .music-queue {
          margin-top: 18px;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
        }

        .music-queue-head {
          margin-bottom: 8px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: hsl(275 28% 66%);
        }

        .music-queue-row {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          height: 50px;
          margin-bottom: 8px;
          padding: 0 10px;
          border: 0;
          border-radius: 14px;
          background: hsl(275 40% 100% / 0.06);
          color: inherit;
          text-align: left;
        }

        .music-queue-swatch {
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
          border-radius: 10px;
        }

        .music-queue-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .music-queue-title {
          font-size: 14px;
          font-weight: 600;
        }

        .music-queue-artist {
          margin-top: 2px;
          font-size: 12px;
          color: hsl(275 28% 70%);
        }

        .music-queue-time {
          margin-left: auto;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          color: hsl(275 24% 62%);
        }
      </style>
    </div>
  </template>
}

export default MusicApp;
