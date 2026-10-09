import { Choreo, type ChoreoRun, type PerformCommand } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { observeStage } from '../lib/onstage';
import { tuneSeconds } from '../lib/tuning';
import FoldNotes from '../notes/fold';

/**
 * The firing schedule. ONE array: it emits the score's `<c.Perform>` steps
 * and the ledger's rows, so the times you read are the times that ran.
 *
 * `hold` is the wait AFTER the command, so a command's own moment is the sum
 * of the holds before it.
 */
const SCHEDULE = [
  {
    action: 'gas.set',
    hold: 0.9,
    note: 'light the burner, low',
    payload: 2,
    target: 'burner',
  },
  {
    action: 'damper.open',
    hold: 0.9,
    note: 'let the chamber breathe',
    payload: undefined,
    target: 'damper',
  },
  {
    action: 'gas.set',
    hold: 0.9,
    note: 'climb to full',
    payload: 5,
    target: 'burner',
  },
  {
    action: 'soak.start',
    hold: 0.9,
    note: 'hold the top temperature',
    payload: undefined,
    target: 'chamber',
  },
  {
    action: 'cone.drop',
    hold: 0.9,
    note: 'the cone bends — this one latches',
    payload: '04',
    target: 'cone',
  },
  {
    action: 'gas.off',
    hold: 0.5,
    note: 'cut the gas, begin the cool',
    payload: undefined,
    target: 'burner',
  },
] as const;

/** each command's moment on the run's clock */
const AT = SCHEDULE.reduce<number[]>((acc, _cmd, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1]! + SCHEDULE[i - 1]!.hold);
  return acc;
}, []);

const DURATION = AT[AT.length - 1]! + SCHEDULE[SCHEDULE.length - 1]!.hold;

/**
 * The kiln's whole state. Not a class with behaviour — four values a
 * reducer writes and the chamber reads.
 */
interface Firing {
  cone: boolean;
  damper: boolean;
  gas: number;
  soak: boolean;
}

const COLD: Firing = { cone: false, damper: false, gas: 0, soak: false };

/**
 * `<c.Perform>` — commands as part of the score (notes/choreo-composition.md §C4).
 *
 * The law is one sentence: THE SET OF COMMANDS AT OR BEFORE THE CLOCK IS THE
 * COMMANDED STATE. Everything here exists to make that visible, because it is
 * a claim about scrubbing that a still frame cannot show.
 *
 * A firing schedule is the honest subject for it. A kiln is not a value you
 * can interpolate backwards: it is the accumulation of the orders given to it.
 * Two of the six orders LATCH — `soak.start` and `cone.drop` set something
 * that no later command clears — and those two are where a naive host is
 * caught, because everything else in the schedule is an absolute setting that
 * happens to re-derive correctly by accident.
 *
 * How a backward seek actually works: Choreo calls `@onPerformReset`, then
 * replays the remaining prefix in order. So the difference between a correct
 * host and a broken one is exactly ONE thing — whether the host honours the
 * reset — and the toggle in this demo turns precisely that off. Nothing else
 * changes: the same score, the same commands, the same clock.
 *
 * The host's state is NOT tracked, and that is load-bearing. `onPerform`
 * fires during the region's pass; a tracked write there would re-render the
 * region, replay the pass, and cancel the run that was dispatching. The
 * chamber is painted by hand in `tick` instead, from CSS custom properties —
 * the same discipline the Build Order transport uses for its clock.
 */
export class Fold extends Component {
  /** bumped to replay the score from cold */
  @tracked take = 0;
  @tracked playing = false;
  /** the A/B: false makes `reset` a no-op, which is the whole bug */
  @tracked honoursReset = true;

  /* — the host: plain fields, painted imperatively — */
  private state: Firing = { ...COLD };
  private resets = 0;
  private dispatches = 0;
  private lit = -1;

  /* — the transport — */
  private t = 0;
  private c?: { run: ChoreoRun | null };
  private seen: ChoreoRun | null = null;
  private stage?: HTMLElement;
  private raf = 0;
  private onstage = false;
  private scrubbing = false;

  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
  }

  get schedule() {
    return SCHEDULE.map((cmd, i) => ({
      ...cmd,
      at: AT[i]!,
      i,
      n: i + 1,
      // where the command sits on the rail, as the transport draws it
      style: htmlSafe(`left:${((AT[i]! / DURATION) * 100).toFixed(2)}%`),
    }));
  }

  /* — the host's two callbacks — */

  dispatch = (command: PerformCommand) => {
    this.dispatches++;
    const s = this.state;
    switch (command.action) {
      case 'gas.set':
        s.gas = Number(command.payload ?? 0);
        break;
      case 'gas.off':
        s.gas = 0;
        break;
      case 'damper.open':
        s.damper = true;
        break;
      case 'soak.start':
        s.soak = true;
        break;
      case 'cone.drop':
        s.cone = true;
        break;
    }
  };

  /**
   * A seek backwards past a command lands here first, and the prefix is
   * replayed after it. Refuse to do the work and the replay lands on top of
   * stale state: the absolute settings overwrite themselves and look fine,
   * while `soak` and `cone` stay latched from a future that no longer exists.
   */
  reset = () => {
    if (!this.honoursReset) {
      return;
    }
    this.resets++;
    this.state = { ...COLD };
  };

  /* — wiring — */

  wire = modifier((_el: Element, [c]: [{ run: ChoreoRun | null }]) => {
    this.c = c;
  });

  register = modifier((el: HTMLElement) => {
    this.stage = el;
    (el as HTMLElement & { fold?: Fold }).fold = this;
    const seen = observeStage(
      el,
      (visible) => {
        this.onstage = visible;
        if (this.onstage) {
          this.raf ||= requestAnimationFrame(this.tick);
          // The score is gated on `take`, so the region plays nothing until
          // something asks for a first pass — page loads do not animate.
          // Being looked at is what asks.
          if (this.take === 0) {
            this.take++;
          }
        } else {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          this.c?.run?.pause();
        }
      },
      { threshold: 0.3 },
    );
    return () => {
      seen.disconnect();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.stage = undefined;
    };
  });

  /* — the frame: a reader, and a painter — */

  private tick = () => {
    const run = this.c?.run ?? null;
    if (run && run !== this.seen) {
      // A replaced pass hands us a NEW run, and `playing` is an intent that
      // outlives the old one. Asserting it here rather than clearing it is
      // what makes "switch host, then press play" work: the click can land
      // before this frame notices the replacement, in which case it played a
      // run that was already being thrown away.
      this.seen = run;
      run.time = 0;
      if (this.playing) {
        run.play();
      } else {
        run.pause();
      }
    }
    if (run) {
      if (this.playing && run.time >= DURATION - 0.02) {
        run.pause();
        this.playing = false;
      }
      this.t = run.time;
    }
    this.paint();
    this.raf = this.onstage ? requestAnimationFrame(this.tick) : 0;
  };

  /**
   * Every readout in one place, written by hand. The chamber is four CSS
   * custom properties; the ledger is one class per row.
   */
  private paint() {
    const el = this.stage;
    if (!el) {
      return;
    }
    const s = this.state;
    el.style.setProperty('--kf-gas', String(s.gas));
    el.style.setProperty('--kf-damper', s.damper ? '1' : '0');
    el.style.setProperty('--kf-soak', s.soak ? '1' : '0');
    el.style.setProperty('--kf-cone', s.cone ? '1' : '0');

    const temp = el.querySelector<HTMLElement>('.kf-temp');
    if (temp) {
      // 20° cold, 1280° at full gas — the number the whole app is named for
      temp.textContent = `${Math.round(20 + s.gas * 252)}°`;
    }
    const clock = el.querySelector<HTMLElement>('.kf-clock');
    if (clock) {
      clock.textContent = `${this.t.toFixed(2)}s`;
    }
    const p = DURATION > 0 ? Math.min(1, this.t / DURATION) : 0;
    const fill = el.querySelector<HTMLElement>('.kf-fill');
    if (fill) {
      fill.style.transform = `scaleX(${p})`;
    }
    const thumb = el.querySelector<HTMLElement>('.kf-thumb');
    if (thumb) {
      // percent of the TRACK, and nothing else. A container unit here reads
      // the whole stage instead, which is where the dot went.
      thumb.style.left = `${(p * 100).toFixed(3)}%`;
    }
    const range = el.querySelector<HTMLInputElement>('.kf-range');
    if (
      range &&
      !this.scrubbing &&
      Math.abs(Number(range.value) - this.t) > 0.01
    ) {
      range.value = String(this.t);
    }
    // the ledger: a row is lit when its command is at or before the clock —
    // the law, drawn
    const reached = AT.filter((at) => at <= this.t + 0.0001).length - 1;
    if (reached !== this.lit) {
      this.lit = reached;
      el.querySelectorAll<HTMLElement>('.kf-row').forEach((row, i) => {
        row.classList.toggle('is-on', i <= reached);
      });
    }
  }

  /* — controls — */

  play = () => {
    // the intent is set FIRST and unconditionally: if the run is mid-swap,
    // `tick` will apply it to whichever run actually arrives
    this.playing = true;
    const run = this.c?.run;
    if (!run) {
      return;
    }
    if (run.time >= DURATION - 0.02) {
      // From the end, start OVER rather than seeking to zero. Seeking is a
      // backward seek, and a host that ignores the reset would carry its
      // latches into the new pass and never come clean — which would look
      // like the demo being stuck rather than the point it is making.
      this.replay();
      this.playing = true;
      return;
    }
    run.play();
  };

  pause = () => {
    this.c?.run?.pause();
    this.playing = false;
  };

  toggle = () => (this.playing ? this.pause() : this.play());

  /** back to cold with a fresh run — the only way to clear a naive host */
  replay = () => {
    this.pause();
    this.state = { ...COLD };
    this.resets = 0;
    this.dispatches = 0;
    this.lit = -1;
    this.take++;
  };

  seek = (t: number) => {
    const run = this.c?.run;
    if (!run) {
      return;
    }
    this.pause();
    run.time = t;
  };

  flip = () => this.setFold(!this.honoursReset);

  scrubStart = () => (this.scrubbing = true);
  scrubEnd = () => (this.scrubbing = false);

  scrub = (event: Event) => {
    const value = Number((event.target as HTMLInputElement).value);
    this.seek(value);
  };

  setFold = (honours: boolean) => {
    this.honoursReset = honours;
    this.replay();
  };

  isFold = (honours: boolean) => this.honoursReset === honours;

  <template>
    {{! The demo container IS the scene: the stove, the read-outs and the
        transport are objects standing in one room, not a card sitting on a
        stage. The region is the room, so a later `<c.Move>` could fly any of
        them without a second coordinate space to cross. }}
    <Choreo
      class='ex kf-stage'
      @onPerform={{this.dispatch}}
      @onPerformReset={{this.reset}}
      {{this.register}}
      as |c|
    >
      <span hidden {{this.wire c}}></span>

      {{! The scene proper: the stove and the schedule stand side by side and
          wrap to a stack when the room is narrow. This is a flex wrap, not a
          container query — `.kf-stage` IS the container element, and an
          element cannot match a query against itself. }}
      <div class='kf-scene'>
        <div class='kf-kiln' data-test-kiln>
          <span class='kf-temp' data-test-temp>20°</span>

          {{! ── the stove ──────────────────────────────────────────────────
           One drawing. Everything that moves is a transform or an opacity —
           see the stylesheet for why nothing here tweens a shadow. ── }}
          <svg
            class='kf-art'
            viewBox='0 0 170 140'
            role='img'
            aria-label='A kiln: the chamber glows with the gas setting, the
              chimney damper swings open, and the pyrometric cone bends when
              it drops.'
            {{motion id='kiln' role='stove'}}
          >
            <defs>
              <radialGradient id='kfHeat' cx='50%' cy='100%' r='86%'>
                <stop offset='0%' stop-color='#fff0c8' />
                <stop offset='24%' stop-color='#ffb04a' />
                <stop offset='52%' stop-color='#f2571a' />
                <stop offset='78%' stop-color='#8c1c08' stop-opacity='0.5' />
                <stop offset='100%' stop-color='#8c1c08' stop-opacity='0' />
              </radialGradient>
              <linearGradient id='kfBrick' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stop-color='var(--kf-brick-a)' />
                <stop offset='100%' stop-color='var(--kf-brick-b)' />
              </linearGradient>
              <linearGradient id='kfFlame' x1='0' y1='1' x2='0' y2='0'>
                <stop offset='0%' stop-color='#fff6de' />
                <stop offset='45%' stop-color='#ffab3d' />
                <stop offset='100%' stop-color='#ff6a1e' stop-opacity='0' />
              </linearGradient>
              <clipPath id='kfMouth'>
                <rect x='38' y='38' width='94' height='70' rx='9' />
              </clipPath>
            </defs>

            {{! the flue, and the damper flap across its throat: closed lies
                flat and blocks it, open stands up and clears it }}
            <rect
              x='114'
              y='0'
              width='28'
              height='22'
              rx='4'
              fill='var(--kf-trim)'
            />
            <rect
              x='120'
              y='5'
              width='16'
              height='15'
              rx='2'
              fill='var(--kf-void)'
            />
            <rect
              class='kf-damper'
              data-test-damper
              x='119'
              y='10.5'
              width='18'
              height='4'
              rx='2'
              fill='var(--kf-flap)'
            />

            {{! shell }}
            <rect
              x='14'
              y='16'
              width='142'
              height='108'
              rx='13'
              fill='url(#kfBrick)'
              stroke='var(--kf-edge)'
              stroke-width='2'
            />
            <rect
              x='14'
              y='16'
              width='142'
              height='14'
              rx='7'
              fill='var(--kf-trim)'
            />
            <rect
              x='24'
              y='124'
              width='18'
              height='9'
              rx='3'
              fill='var(--kf-trim)'
            />
            <rect
              x='128'
              y='124'
              width='18'
              height='9'
              rx='3'
              fill='var(--kf-trim)'
            />

            {{! the mouth, and everything that burns inside it }}
            <rect
              x='38'
              y='38'
              width='94'
              height='70'
              rx='9'
              fill='var(--kf-void)'
            />
            <g clip-path='url(#kfMouth)'>
              <ellipse
                class='kf-glow'
                cx='85'
                cy='110'
                rx='66'
                ry='54'
                fill='url(#kfHeat)'
              />
              <path
                class='kf-flame'
                data-test-flame
                d='M72 102 C62 90 64 79 72 65 C80 79 82 90 72 102 Z'
                fill='url(#kfFlame)'
              />
              {{! the cone stands on a shelf so it reads as an object, and
                  bends about the point it is actually standing on }}
              <rect
                x='99'
                y='99'
                width='26'
                height='4'
                rx='1.5'
                fill='var(--kf-shelf)'
              />
              <polygon
                class='kf-cone'
                data-test-cone
                points='112,70 117.5,99 106.5,99'
                fill='var(--kf-clay)'
              />
              <rect
                x='38'
                y='103'
                width='94'
                height='6'
                fill='var(--kf-shelf)'
              />
            </g>
            <rect
              x='38'
              y='38'
              width='94'
              height='70'
              rx='9'
              fill='none'
              stroke='var(--kf-edge)'
              stroke-width='1.5'
            />
          </svg>
          <span class='kf-soak' data-test-soak>SOAKING</span>
        </div>

        {{! ── the schedule: the law, drawn ───────────────────────────── }}
        <ol class='kf-ledger' data-test-ledger>
          {{#each this.schedule as |cmd|}}
            <li>
              {{! Clicking a step seeks to its moment. This is the rewind
                  control the footer used to hold: step 2 is the interesting
                  one, because everything after it is a latch. }}
              <button
                type='button'
                class='kf-row'
                data-test-row={{cmd.i}}
                {{on 'click' (fn this.seek cmd.at)}}
              >
                <span class='kf-num'>{{cmd.n}}</span>
                <span class='kf-action'>{{cmd.action}}</span>
                <span class='kf-arg'>{{if cmd.payload cmd.payload ''}}</span>
              </button>
            </li>
          {{/each}}
        </ol>
      </div>

      {{! ── the transport, in the Playhead idiom: a rail with a mark per
           command, and a real range input invisible over the drawing. Its
           value is written by `paint`, never bound — a tracked binding would
           re-render at 60fps, and a programmatic write mid-drag detaches
           WebKit's thumb. ── }}
      <div class='kf-transport'>
        <button
          type='button'
          class='kf-play'
          aria-label={{if this.playing 'Pause' 'Play'}}
          data-test-play
          {{on 'click' this.toggle}}
        >
          {{#if this.playing}}
            <svg class='kf-icon' viewBox='0 0 24 24' aria-hidden='true'>
              <rect x='14' y='3' width='5' height='18' rx='1' />
              <rect x='5' y='3' width='5' height='18' rx='1' />
            </svg>
          {{else}}
            <svg class='kf-icon' viewBox='0 0 24 24' aria-hidden='true'>
              <path d='M6 4l14 8-14 8z' />
            </svg>
          {{/if}}
        </button>

        <div class='kf-track'>
          <span class='kf-rail'></span>
          <span class='kf-fill'></span>
          {{#each this.schedule as |cmd|}}
            <i class='kf-mark' style={{cmd.style}}></i>
          {{/each}}
          <span class='kf-thumb'></span>
          <input
            class='kf-range'
            type='range'
            min='0'
            max={{DURATION}}
            step='0.01'
            value='0'
            aria-label='Playhead'
            data-test-range
            {{on 'pointerdown' this.scrubStart}}
            {{on 'pointerup' this.scrubEnd}}
            {{on 'pointercancel' this.scrubEnd}}
            {{on 'input' this.scrub}}
          />
        </div>

        <span class='kf-clock'>0.00s</span>

        {{! The A/B, as one switch. Its two states are the demo's whole
            argument, so it wears the warning colour in the wrong one — a
            reader who never presses it still knows which is the bug. }}
        <button
          type='button'
          class={{if (this.isFold true) 'kf-host' 'kf-host is-bad'}}
          data-test-host
          title={{if
            (this.isFold true)
            'On a rewind the host clears its state and Choreo replays the commands before the clock. Click a step to rewind to it.'
            'The host ignores the reset, so the replay lands on stale state: soak and the cone stay set from a time that has not happened yet.'
          }}
          {{on 'click' this.flip}}
        >{{if
            (this.isFold true)
            'HOST HONOURS RESET'
            'HOST IGNORES RESET'
          }}</button>
      </div>

      {{#if this.take}}
        <c.Sequence>
          {{#each SCHEDULE as |cmd|}}
            <c.Perform
              @action={{cmd.action}}
              @target={{cmd.target}}
              @payload={{cmd.payload}}
            />
            <c.Wait
              @duration={{tuneSeconds 'fold' cmd.hold 'cmd.hold duration'}}
            />
          {{/each}}
        </c.Sequence>
      {{/if}}
    </Choreo>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      /* ── Perform: the kiln firing ────────────────────────────────────────────
         The demo container IS the scene. The stove, the schedule and the transport
         are objects standing in one room rather than a card on a stage, so a later
         `<c.Move>` could fly any of them without a second coordinate space.

         WHY NOTHING HERE TWEENS A SHADOW
         The heat is the one thing that changes continuously, so it is the one worth
         being strict about. `box-shadow`, `text-shadow`, `filter: blur()` and
         `drop-shadow()` are all re-rasterised on every frame that touches them, and
         a shadow string is re-parsed and rebuilt besides — the trap the Crossing
         demo documents for its three lights. The cheap pair is `opacity` and
         `transform`, which composite without repainting.

         So every glow is a STATIC gradient drawn once at full strength, and heat is
         the opacity it is shown at. The flame does not grow by animating `height`,
         which is layout; it is one path scaled on Y. The cone and the damper
         rotate. That is the whole vocabulary.

         The stove reads four custom properties the host writes each frame
         (--kf-gas 0..5, --kf-damper, --kf-soak, --kf-cone). Nothing here is animated
         BY the score: this is the app's own state, which the score only commands,
         and no rule below knows the timeline exists. */
      .kf-stage {
        --kf-gas: 0;
        --kf-damper: 0;
        --kf-soak: 0;
        --kf-cone: 0;
        /* The scene's whole palette, so one block below can move it into daylight.
           The FIRE is deliberately not in here: a flame is the same colour in a dark
           room and a bright one, and the glow reads on either ground because it is
           opacity over a static gradient rather than a colour being mixed. */
        --kf-ink: #ffeede;
        --kf-dim: #a08b7d;
        --kf-hot: #ff7a28;
        --kf-ember: #ffb35a;
        --kf-room-a: #1b1512;
        --kf-room-b: #100c0a;
        --kf-brick-a: #3a2f29;
        --kf-brick-b: #1d1614;
        --kf-trim: #4a3a31;
        --kf-void: #120d0b;
        --kf-shelf: #0d0908;
        --kf-edge: #6d5647;
        --kf-flap: #c49a7c;
        --kf-clay: #f3e6cd;
        --kf-hair: rgb(255 255 255 / 14%);
        --kf-mark: rgb(255 255 255 / 34%);
        /* 0 cold, 1 at full gas — every heat-driven rule reads this, so the mapping
           lives in exactly one place */
        --kf-heat: calc(var(--kf-gas) / 5);

        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: stretch;
        justify-content: center;
        padding: 10px 12px;
        background:
          radial-gradient(
            70% 55% at 50% 86%,
            rgb(255 122 40 / calc(var(--kf-heat) * 26%)),
            transparent 70%
          ),
          linear-gradient(180deg, var(--kf-room-a) 0%, var(--kf-room-b) 100%);
        color: var(--kf-ink);
      }

      /* Daylight: the same workshop with the lights on. The mouth and the shelf stay
         dark, because the inside of a kiln is dark at noon too — the theme moves the
         ROOM and the stove's clay, never the fire or the void it burns in. */
      .choreo-site[data-theme='light'] .kf-stage {
        --kf-ink: #2a1f16;
        --kf-dim: #7a6857;
        --kf-ember: #b8430c;
        --kf-room-a: #e7ddcd;
        --kf-room-b: #d6c9b4;
        --kf-brick-a: #bcab95;
        --kf-brick-b: #97836c;
        --kf-trim: #8a7660;
        --kf-void: #241a14;
        --kf-shelf: #1a120d;
        --kf-edge: #6e5c48;
        --kf-flap: #6b563f;
        --kf-clay: #fdf6e8;
        --kf-hair: rgb(42 31 22 / 20%);
        --kf-mark: rgb(42 31 22 / 36%);
      }
      /* `flex: 0 1 auto`, not `1 1 auto`. Growing to fill the stage and then
         centring the content inside itself leaves the scene's own slack BELOW the
         schedule — a void between it and the transport. At its natural height the
         stage centres scene-and-transport together, as one block. */
      .kf-scene {
        display: flex;
        flex: 0 1 auto;
        flex-wrap: wrap;
        gap: 10px 18px;
        align-items: center;
        justify-content: center;
        /* the demo page's room is far wider than the scene wants to be; past this
           the objects would just drift apart */
        width: 100%;
        max-width: 560px;
        margin-inline: auto;
      }

      .kf-kiln {
        flex: 1 1 165px;
        max-width: 230px;
      }

      .kf-ledger {
        flex: 2 1 215px;
        max-width: 330px;
      }

      /* the one big number — a game reads its state out loud. Colour is a paint,
         but it steps once per command rather than tweening per frame. */
      .kf-temp {
        font:
          800 clamp(24px, 8cqw, 40px) / 1 'Syne',
          sans-serif;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.03em;
        /* No transition on this one. `color-mix()` whose inputs are unregistered
           custom properties does not re-resolve while a transition is holding the
           property: the number kept the dark palette's colour after a theme swap.
           It steps once per command anyway, so there was never much to tween. */
        color: color-mix(
          in oklab,
          var(--kf-dim),
          var(--kf-ember) calc(var(--kf-heat) * 100%)
        );
      }

      /* — the stove — */

      .kf-kiln {
        position: relative;
        display: grid;
        /* the flue rises to the very top of the viewBox, so the read-out needs real
           air under it or the degree sign sits on the chimney */
        gap: 10px;
        justify-items: center;
      }

      /* the light it throws into the room: a static bloom, faded in. This is the
         rule that would otherwise have been an animated box-shadow. */
      .kf-kiln::after {
        content: '';
        position: absolute;
        inset: -16%;
        background: radial-gradient(
          56% 44% at 50% 62%,
          rgb(255 122 40 / 40%),
          transparent 72%
        );
        opacity: var(--kf-heat);
        pointer-events: none;
        transition: opacity 420ms linear;
      }

      .kf-art {
        position: relative;
        z-index: 1;
        display: block;
        width: 100%;
        max-width: 190px;
        height: auto;
      }

      .kf-glow {
        opacity: var(--kf-heat);
        transition: opacity 420ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      /* the flame grows by SCALE, not height: a transform, so no layout and no
         repaint — drawn once at full size, squashed toward its base */
      .kf-flame {
        opacity: var(--kf-heat);
        scale: 1 calc(0.16 + var(--kf-heat) * 0.84);
        transform-box: fill-box;
        transform-origin: 50% 100%;
        transition:
          scale 420ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 300ms linear;
      }
      /* Both hinges are given in VIEW-BOX units, not percentages of the shape's own
         box. `fill-box` percentages are resolved against a bounding box the browser
         computes for the geometry, which moves the moment the path does — and a
         rotation whose pivot drifts is the classic reason an SVG part looks
         detached mid-swing. These pivots are literal points in the drawing: the
         flap's hinge pin, and the spot the cone is standing on. */
      .kf-cone {
        rotate: calc(var(--kf-cone) * 52deg);
        transform-box: view-box;
        transform-origin: 112px 99px;
        transition: rotate 560ms cubic-bezier(0.34, 1.32, 0.64, 1);
      }

      .kf-damper {
        rotate: calc(var(--kf-damper) * 74deg);
        transform-box: view-box;
        transform-origin: 128px 12.5px;
        transition: rotate 380ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      /* soak is the one latch with nothing of its own to bend, so it gets a word */
      .kf-soak {
        justify-self: center;
        padding: 2px 9px;
        border-radius: 999px;
        background: color-mix(in oklab, var(--kf-void) 82%, transparent);
        color: var(--kf-clay);
        font-family: var(--font-mono);
        font-size: clamp(7px, 1.9cqw, 9px);
        font-weight: 700;
        letter-spacing: 0.2em;
        /* holds its box when dark, so lighting it shifts nothing */
        opacity: var(--kf-soak);
        transition: opacity 260ms linear;
      }

      /* — the schedule — */

      .kf-ledger {
        display: grid;
        gap: 3px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .kf-row {
        display: grid;
        width: 100%;
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        opacity: 0.38;
        transition:
          opacity 200ms linear,
          background-color 200ms linear,
          border-color 200ms linear;
      }

      /* lit when the command is at or before the clock — the law, drawn */
      .kf-row.is-on {
        border-color: rgb(255 122 40 / 28%);
        background: rgb(255 122 40 / 10%);
        opacity: 1;
      }

      .kf-num {
        display: grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border: 1px solid var(--kf-hair);
        border-radius: 50%;
        color: var(--kf-dim);
        font-family: var(--font-mono);
        font-size: 8px;
        font-weight: 700;
      }

      .kf-row.is-on .kf-num {
        border-color: transparent;
        background: var(--kf-hot);
        color: #1a0f08;
      }

      .kf-action {
        overflow: hidden;
        font-family: var(--font-mono);
        font-size: clamp(8.5px, 2.2cqw, 11px);
        font-weight: 700;
        letter-spacing: 0.06em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .kf-arg {
        color: var(--kf-ember);
        font-family: var(--font-mono);
        font-size: clamp(8.5px, 2.2cqw, 11px);
        font-weight: 700;
      }

      /* — the transport, in the Playhead idiom — */

      .kf-transport {
        display: flex;
        gap: 10px;
        align-items: center;
        width: 100%;
        max-width: 560px;
        margin-inline: auto;
      }

      .kf-play {
        display: grid;
        flex: none;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 50%;
        background: linear-gradient(180deg, #ff9a4a, #ef5f14);
        color: #2a1206;
        cursor: pointer;
      }

      .kf-play:active {
        translate: 0 1px;
      }

      .kf-icon {
        width: 12px;
        height: 12px;
        fill: currentcolor;
      }

      .kf-track {
        position: relative;
        flex: 1 1 auto;
        height: 20px;
      }

      .kf-rail,
      .kf-fill {
        position: absolute;
        top: 50%;
        left: 0;
        width: 100%;
        height: 3px;
        margin-top: -1.5px;
        border-radius: 2px;
      }

      .kf-rail {
        background: var(--kf-hair);
      }

      /* scaleX from `paint`, so the bar redraws without a render */
      .kf-fill {
        background: linear-gradient(90deg, #ff9a4a, var(--kf-hot));
        transform-origin: left center;
      }

      /* one mark per command: the schedule, read off the same array the score is
         built from */
      .kf-mark {
        position: absolute;
        top: 50%;
        z-index: 1;
        width: 2px;
        height: 9px;
        border-radius: 1px;
        background: var(--kf-mark);
        transform: translate(-1px, -50%);
      }

      .kf-thumb {
        position: absolute;
        top: 50%;
        left: 0;
        z-index: 2;
        width: 10px;
        height: 10px;
        margin: -5px 0 0 -5px;
        border-radius: 50%;
        background: var(--kf-clay);
        border: 1px solid var(--kf-hot);
      }

      /* the real control, invisible over the drawing. `touch-action: none` because
         a sideways drag here can only mean the playhead — otherwise the scroller
         takes the gesture and the timeline reads as broken. */
      .kf-range {
        position: absolute;
        inset: 0;
        z-index: 3;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        background: none;
        opacity: 0;
        cursor: ew-resize;
        touch-action: none;
        appearance: none;
      }

      .kf-clock {
        flex: none;
        min-width: 42px;
        color: var(--kf-dim);
        font-family: var(--font-mono);
        font-size: clamp(9px, 2.2cqw, 11px);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.06em;
        text-align: right;
      }

      /* — the A/B, now one switch on the transport row — */

      .kf-host {
        flex: none;
        padding: 5px 10px;
        border: 1px solid var(--kf-hair);
        border-radius: 999px;
        background: transparent;
        color: var(--kf-dim);
        font-family: var(--font-mono);
        font-size: clamp(7.5px, 1.9cqw, 9px);
        font-weight: 700;
        letter-spacing: 0.1em;
        cursor: pointer;
      }

      /* the wrong state wears the warning, so a reader who never presses it still
         knows which one is the bug */
      .kf-host.is-bad {
        border-color: transparent;
        background: linear-gradient(180deg, #ff6b6b, #d33);
        color: #2a0606;
      }

      .kf-host:active {
        translate: 0 1px;
      }
      @container (max-width: 430px) {
        .kf-art {
          max-width: 128px;
        }

        .kf-temp {
          font:
            800 clamp(20px, 7cqw, 26px) / 1 'Syne',
            sans-serif;
        }

        .kf-ledger {
          gap: 2px;
        }

        .kf-row {
          gap: 6px;
          padding: 2px 6px;
        }

        .kf-num {
          width: 14px;
          height: 14px;
          font-size: 7px;
        }

        .kf-scene {
          gap: 6px 12px;
        }
      }
      @container (min-width: 640px) {
        .kf-art {
          max-width: 240px;
        }

        .kf-scene {
          max-width: 640px;
          gap: 12px 26px;
        }

        .kf-row {
          padding: 5px 10px;
        }

        .kf-ledger {
          max-width: 360px;
        }

        .kf-transport {
          max-width: 640px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .kf-kiln::after,
        .kf-glow,
        .kf-flame,
        .kf-cone,
        .kf-damper,
        .kf-soak,
        .kf-row {
          transition: none;
        }
      }
    </style>
  </template>
}

export class FoldDemo extends GalleryDemo {
  static stage = Fold;
  static notes = FoldNotes;
}
