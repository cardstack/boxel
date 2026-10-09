import { Choreo, type Rect } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, spring } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSeconds, tuneSpring } from '../lib/tuning';
import WiresNotes from '../notes/wires';

const GLIDE = spring({ damping: 28, stiffness: 240 });

/**
 * Smooth, always. The lift fans overlapping cubics so three threads can
 * share a gap without an elbow.
 */
const curve =
  (lift = 0) =>
  (a: Rect, b: Rect) => {
    const x1 = a.x + a.width;
    const y1 = a.y + a.height / 2;
    const x2 = b.x;
    const y2 = b.y + b.height / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1 + lift}, ${mx} ${y2 + lift}, ${x2} ${y2}`;
  };

type ThreadId = 'edition' | 'gauge' | 'hed';

interface Piece {
  id?: string;
  key: string;
  text: string;
  thread?: ThreadId;
}

interface Note {
  body: string;
  by: string;
  id: string;
  thread: ThreadId;
}

interface Draft {
  copy: Piece[];
  notes: Note[];
}

const PATH_GAUGE = curve(-10);
const PATH_EDITION = curve(0);
const PATH_HED = curve(12);

const THREADS: {
  from: string;
  path: (a: Rect, b: Rect) => string;
  thread: ThreadId;
  to: string;
}[] = [
  { from: 'm-gauge', path: PATH_GAUGE, thread: 'gauge', to: 'c-gauge' },
  { from: 'm-edition', path: PATH_EDITION, thread: 'edition', to: 'c-edition' },
  { from: 'm-hed', path: PATH_HED, thread: 'hed', to: 'c-hed' },
];

const DRAFTS: Draft[] = [
  {
    copy: [
      { key: 'a0', text: 'The river ' },
      { id: 'm-gauge', key: 'g', text: 'rose overnight', thread: 'gauge' },
      { key: 'a1', text: '. We hold the ' },
      { id: 'm-edition', key: 'e', text: 'morning edition', thread: 'edition' },
      { key: 'a2', text: ' for the levee update.' },
    ],
    notes: [
      {
        body: 'Confirm with the gauge at first light.',
        by: 'Maya',
        id: 'c-gauge',
        thread: 'gauge',
      },
      {
        body: 'City desk wants 800, not 400.',
        by: 'Ed',
        id: 'c-edition',
        thread: 'edition',
      },
    ],
  },
  {
    copy: [
      { key: 'a0', text: 'The river ' },
      { id: 'm-gauge', key: 'g', text: 'rose overnight', thread: 'gauge' },
      {
        key: 'a1',
        text: ', and the lower ward is already sandbagging. We hold the ',
      },
      { id: 'm-edition', key: 'e', text: 'morning edition', thread: 'edition' },
      { key: 'a2', text: ' for the levee update, then lead with the ' },
      { id: 'm-hed', key: 'h', text: "mayor's walk", thread: 'hed' },
      { key: 'a3', text: '.' },
    ],
    notes: [
      {
        body: "Gauge at 14.2. Don't say flood until they do.",
        by: 'Maya',
        id: 'c-gauge',
        thread: 'gauge',
      },
      {
        body: '800. Keep the levee in the hed.',
        by: 'Ed',
        id: 'c-edition',
        thread: 'edition',
      },
      {
        body: "She hasn't confirmed. Hedge it.",
        by: 'Jo',
        id: 'c-hed',
        thread: 'hed',
      },
    ],
  },
  {
    copy: [
      {
        key: 'a0',
        text: 'The river rose overnight, and the lower ward is already sandbagging. We hold the ',
      },
      { id: 'm-edition', key: 'e', text: 'morning edition', thread: 'edition' },
      {
        key: 'a2',
        text: " for the levee update, then lead with the mayor's walk — ",
      },
      { id: 'm-hed', key: 'h', text: 'if she walks', thread: 'hed' },
      { key: 'a3', text: ". If she doesn't, " },
      {
        id: 'm-gauge',
        key: 'g',
        text: 'the gauge is the story',
        thread: 'gauge',
      },
      { key: 'a4', text: '.' },
    ],
    notes: [
      {
        body: "That's the hed. Play it.",
        by: 'Maya',
        id: 'c-gauge',
        thread: 'gauge',
      },
      {
        body: '800 stands.',
        by: 'Ed',
        id: 'c-edition',
        thread: 'edition',
      },
      {
        body: 'Confirmed 7am. Drop the hedge.',
        by: 'Jo',
        id: 'c-hed',
        thread: 'hed',
      },
    ],
  },
];

/**
 * Resting ink — the same cubics the run draws. Paths are kept by thread id
 * so a connected wire is retargeted, not torn down and faded back in.
 */
function paintRest(svg: SVGSVGElement) {
  const root = svg.closest('.wires');
  if (!root) {
    return;
  }
  // Client rects carry every ancestor transform — including the page
  // crossing, which is scaling this whole stage mid-flight while the
  // follow loop repaints. Subtracting raw client coordinates baked that
  // scale into the ink and the threads stood ~10px off their marks for
  // the whole flight; mapping through the svg's own screen CTM lands
  // them in user units no matter what is carrying the page this frame —
  // the same mapping, for the same reason, as the engine's drawTether.
  const inverse = svg.getScreenCTM()?.inverse();
  const R = root.getBoundingClientRect();
  const toLocal = (x: number, y: number) => {
    if (!inverse) {
      return { x: x - R.left, y: y - R.top };
    }
    const p = new DOMPoint(x, y).matrixTransform(inverse);
    return { x: p.x, y: p.y };
  };
  const box = (id: string): Rect | null => {
    const el = root.querySelector(`[data-node="${id}"]`);
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    const tl = toLocal(r.left, r.top);
    const br = toLocal(r.right, r.bottom);
    return {
      height: br.y - tl.y,
      width: br.x - tl.x,
      x: tl.x,
      y: tl.y,
    };
  };
  const keep = new Set<string>();
  for (const thread of THREADS) {
    const a = box(thread.from);
    const b = box(thread.to);
    if (!a || !b) {
      continue;
    }
    keep.add(thread.thread);
    let path = svg.querySelector(
      `:scope > [data-thread="${thread.thread}"]`,
    ) as SVGPathElement | null;
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'wires-thread');
      path.setAttribute('data-thread', thread.thread);
      svg.append(path);
    }
    path.setAttribute('d', thread.path(a, b));
  }
  for (const path of [...svg.querySelectorAll(':scope > path')]) {
    const id = path.getAttribute('data-thread');
    if (!id || !keep.has(id)) {
      path.remove();
    }
  }
}

const eq = (a: number, b: number) => a === b;
const VERSIONS = [0, 1, 2];
const label = (v: number) => `V${v + 1}`;
const draftNo = (v: number) => String(v + 1);

/**
 * A morning note, three drafts. Marks in the prose, comments in the margin;
 * the thread between them is not a tween. The first comment is selected on
 * load; hover or tap another pair to move the thread. Step V1 → V2 → V3 and
 * the copy grows, the comments update, and every wire is asked again on
 * every frame of the spring.
 */
export class Wires extends Component {
  @tracked version = 0;

  rest = modifier((el: SVGSVGElement, [version]: [number]) => {
    void version;
    const root = el.closest('.wires');
    const layer = root?.querySelector('[data-choreo-tethers]');
    let follow = 0;
    const pin = () => {
      if (!root) {
        return;
      }
      const hot = root.getAttribute('data-hot');
      if (hot && root.querySelector(`[data-thread="${hot}"]`)) {
        return;
      }
      const first = root.querySelector(
        '[data-test-wires-note]',
      ) as HTMLElement | null;
      root.setAttribute('data-hot', first?.dataset.thread ?? 'gauge');
    };
    const draw = () => {
      paintRest(el);
      pin();
    };
    const followDraw = () => {
      draw();
      follow = root?.querySelector('[data-choreo-tether]')
        ? requestAnimationFrame(followDraw)
        : 0;
    };
    const startFollow = () => {
      if (!follow) {
        follow = requestAnimationFrame(followDraw);
      }
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(draw));
    const ro =
      root && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => requestAnimationFrame(draw))
        : null;
    const mo =
      layer && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(startFollow)
        : null;
    if (root) {
      ro?.observe(root);
    }
    if (layer) {
      mo?.observe(layer, { childList: true });
    }
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(follow);
      ro?.disconnect();
      mo?.disconnect();
    };
  });

  /**
   * Pair a mark with its comment — an attribute on the region, not a tracked
   * write. A tracked hot would re-render the parent and restart the run.
   * Selection sticks: the first comment is on by default; hover or tap
   * another pair to move the thread.
   */
  pair = modifier((el: HTMLElement) => {
    const root = () => el.closest('.wires');
    const id = el.dataset.thread ?? '';
    const select = () => root()?.setAttribute('data-hot', id);
    el.addEventListener('pointerenter', select);
    el.addEventListener('focus', select);
    el.addEventListener('click', select);
    return () => {
      el.removeEventListener('pointerenter', select);
      el.removeEventListener('focus', select);
      el.removeEventListener('click', select);
    };
  });

  get draft() {
    return DRAFTS[this.version]!;
  }

  go = (version: number) => {
    this.version = version;
  };

  isMark = (part: Piece) => Boolean(part.id);

  <template>
    <div class='ex'>
      <div class='wires-bar' role='group' aria-label='Draft'>
        <span class='wires-bar-label'>Draft</span>
        {{#each VERSIONS as |v|}}
          <button
            type='button'
            class={{if (eq v this.version) 'is-on'}}
            aria-pressed='{{eq v this.version}}'
            data-test-wires-v={{label v}}
            {{on 'click' (fn this.go v)}}
          >{{draftNo v}}</button>
        {{/each}}
      </div>

      <Choreo class='wires' data-hot='gauge' data-test-wires as |c|>
        <svg
          class='wires-rest'
          aria-hidden='true'
          {{this.rest this.version}}
        ></svg>

        <div class='wires-board'>
          <article class='wires-paper'>
            <header class='wires-head'>
              <p class='wires-kicker'>
                <span>City desk</span>
                <time datetime='06:12'>6:12 a.m.</time>
              </p>
              <h2 class='wires-hed'>Morning note</h2>
            </header>
            <p class='wires-copy'>
              {{#each this.draft.copy key='key' as |part|}}
                {{#if (this.isMark part)}}
                  <mark
                    class='wires-mark'
                    data-node={{part.id}}
                    data-thread={{part.thread}}
                    data-test-wires-mark={{part.thread}}
                    tabindex='0'
                    {{motion id=part.id role='mark'}}
                    {{this.pair}}
                  >{{part.text}}</mark>
                {{else}}
                  {{part.text}}
                {{/if}}
              {{/each}}
            </p>
          </article>

          <ol class='wires-margin' aria-label='Comments on this draft'>
            {{#each this.draft.notes key='id' as |note|}}
              <li
                class='wires-note'
                data-node={{note.id}}
                data-thread={{note.thread}}
                data-test-wires-note={{note.thread}}
                tabindex='0'
                {{motion id=note.id role='note'}}
                {{this.pair}}
              >
                <span class='wires-hue' aria-hidden='true'></span>
                <span class='wires-note-copy'>
                  <span class='wires-who'>{{note.by}}</span>
                  <p>{{note.body}}</p>
                </span>
              </li>
            {{/each}}
          </ol>
        </div>

        <c.Parallel>
          <c.Hold @of={{c.role 'note'}} @zIndex={{3}} />
          <c.Move
            @of={{c.moved 'mark'}}
            @spring={{tuneSpring 'wires' GLIDE 'GLIDE'}}
            @size={{false}}
          />
          <c.Move
            @of={{c.moved 'note'}}
            @spring={{tuneSpring 'wires' GLIDE 'GLIDE'}}
          />
          <c.Tween
            @of={{c.removed 'note'}}
            @opacity={{0}}
            @y={{-8}}
            @duration={{tuneSeconds 'wires' 0.28 'Step 1 duration'}}
            @ease='easeOut'
          />
          <c.Tween
            @of={{c.inserted 'note'}}
            @opacity={{array 0 1}}
            @y={{array 8 0}}
            @duration={{tuneSeconds 'wires' 0.32 'Step 2 duration'}}
            @ease='easeOut'
          />
          <c.Tether
            @name='gauge'
            @from={{c.id 'm-gauge'}}
            @to={{c.id 'c-gauge'}}
            @path={{PATH_GAUGE}}
          />
          <c.Tether
            @name='edition'
            @from={{c.id 'm-edition'}}
            @to={{c.id 'c-edition'}}
            @path={{PATH_EDITION}}
          />
          <c.Tether
            @name='hed'
            @from={{c.id 'm-hed'}}
            @to={{c.id 'c-hed'}}
            @path={{PATH_HED}}
          />
        </c.Parallel>
      </Choreo>
    </div>
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
           The block padding was missing for a long time and it showed on any stage
           tall enough to fill the platter: the content sat flush against the top and
           bottom of the recess while keeping its 16px at the sides, which reads as
           content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      /* ---- Wires: comments that keep their hold ---- */

      .ex:has(.wires) {
        padding-block: 20px;
        -webkit-user-select: text;
        user-select: text;
      }

      .wires-bar {
        position: absolute;
        top: 14px;
        left: 50%;
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 3px 4px 3px 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--bg-elev);
        transform: translateX(-50%);
      }

      .wires-bar-label {
        margin-right: 6px;
        font-family: var(--font);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: var(--ink-faint);
      }

      .wires-bar button {
        border: 0;
        background: transparent;
        border-radius: 999px;
        min-width: 26px;
        padding: 4px 9px;
        font-family: var(--font);
        font-size: 12px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--ink-faint);
      }

      @media (hover: hover) {
        .wires-bar button:hover {
          color: var(--ink);
        }
      }

      .wires-bar button.is-on {
        background: color-mix(in srgb, var(--ink) 8%, transparent);
        color: var(--ink);
      }

      .wires {
        position: relative;
        width: min(90cqw, 640px);
        padding: 44px 6px 8px;
        overflow: visible;
        /* inline-size only: a size container with auto height reports 0 block
           size, so the compact query would always match on the demo page. */
        container-type: inline-size;
      }

      .wires-board {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(148px, 0.68fr);
        grid-template-rows: auto 1fr;
        column-gap: 24px;
      }

      .wires-board::before {
        content: '';
        grid-column: 1;
        grid-row: 1 / span 2;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--bg-spot);
        pointer-events: none;
      }

      .wires-paper {
        display: contents;
      }

      .wires-head {
        grid-column: 1;
        grid-row: 1;
        z-index: 1;
        min-width: 0;
        margin: 0;
        padding: clamp(14px, 4cqw, 26px) clamp(16px, 4.7cqw, 30px)
          clamp(8px, 2.2cqw, 14px);
        border-bottom: 1px solid var(--line);
      }

      .wires-kicker {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin: 0 0 10px;
        font-family: var(--font);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .wires-hed {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(1rem, 4.8cqw, 1.9rem);
        font-weight: 700;
        letter-spacing: -0.035em;
        line-height: 1.12;
        color: var(--ink);
      }

      .wires-copy {
        grid-column: 1;
        grid-row: 2;
        z-index: 1;
        min-width: 0;
        margin: 0;
        padding: clamp(12px, 3.2cqw, 20px) clamp(16px, 4.7cqw, 30px)
          clamp(16px, 5cqw, 32px);
        max-width: none;
        font-family: var(--font);
        font-size: clamp(0.8rem, 3.3cqw, 1.24rem);
        font-weight: 400;
        line-height: 1.8;
        letter-spacing: -0.006em;
        color: var(--ink);
      }

      .wires-rest {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
        z-index: 2;
      }

      /* The tether layer is the region's own markup and the resting threads are
         drawn from script, so neither carries this template's scope: both are
         reached through :deep(). */
      .wires :deep([data-choreo-tethers]) {
        z-index: 2;
        overflow: visible;
      }

      /* Live tethers still run — tests read them — but the ink you see is the
         resting path, retargeted every frame. Hiding rest here replayed a fade. */
      .wires :deep([data-choreo-tether]) {
        visibility: hidden;
      }

      .wires :deep([data-choreo-tether]),
      .wires :deep(.wires-thread) {
        fill: none;
        stroke-width: 1.15;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .wires :deep(.wires-thread) {
        opacity: 0;
        transition: opacity 0.18s var(--ease);
      }

      .wires[data-hot='gauge'] :deep(.wires-thread[data-thread='gauge']),
      .wires[data-hot='edition'] :deep(.wires-thread[data-thread='edition']),
      .wires[data-hot='hed'] :deep(.wires-thread[data-thread='hed']) {
        opacity: 1;
      }

      .wires :deep([data-thread='gauge']) {
        --wires-ink: var(--copper-ink);
        --wires-wash: var(--copper);
      }

      .wires :deep([data-thread='edition']) {
        --wires-ink: var(--iris);
        --wires-wash: var(--iris);
      }

      .wires :deep([data-thread='hed']) {
        --wires-ink: var(--teal);
        --wires-wash: var(--teal);
      }

      .wires :deep([data-choreo-tether]),
      .wires :deep(.wires-thread) {
        stroke: var(--wires-ink);
      }

      .wires-mark {
        padding: 0.02em 0.1em;
        background: color-mix(in srgb, var(--wires-wash) 14%, transparent);
        color: inherit;
        font-style: normal;
        border-radius: 2px;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        cursor: pointer;
        outline: none;
      }

      .wires[data-hot='gauge'] .wires-mark[data-thread='gauge'],
      .wires[data-hot='edition'] .wires-mark[data-thread='edition'],
      .wires[data-hot='hed'] .wires-mark[data-thread='hed'] {
        background: color-mix(in srgb, var(--wires-wash) 24%, transparent);
      }

      .wires-margin {
        grid-column: 2;
        grid-row: 2;
        position: relative;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: clamp(8px, 2.2cqw, 14px);
        margin: 0;
        padding: clamp(12px, 3.2cqw, 20px) 0 8px;
        list-style: none;
      }

      .wires-note {
        display: flex;
        align-items: stretch;
        gap: 10px;
        padding: 2px 2px 2px 0;
        border: 0;
        background: transparent;
        cursor: pointer;
        outline: none;
      }

      .wires-hue {
        width: 3px;
        flex: none;
        align-self: stretch;
        min-height: 22px;
        border-radius: 2px;
        background: var(--wires-ink);
        opacity: 0.45;
        transition: opacity 0.16s var(--ease);
      }

      .wires-note-copy {
        min-width: 0;
        flex: 1;
        padding: 1px 0 2px;
        opacity: 0.58;
        transition: opacity 0.16s var(--ease);
      }

      .wires[data-hot='gauge'] .wires-note[data-thread='gauge'] .wires-hue,
      .wires[data-hot='edition'] .wires-note[data-thread='edition'] .wires-hue,
      .wires[data-hot='hed'] .wires-note[data-thread='hed'] .wires-hue,
      .wires[data-hot='gauge']
        .wires-note[data-thread='gauge']
        .wires-note-copy,
      .wires[data-hot='edition']
        .wires-note[data-thread='edition']
        .wires-note-copy,
      .wires[data-hot='hed'] .wires-note[data-thread='hed'] .wires-note-copy {
        opacity: 1;
      }

      .wires-who {
        display: block;
        font-family: var(--font);
        font-size: clamp(10px, 2cqw, 13px);
        font-style: normal;
        font-weight: 600;
        letter-spacing: -0.01em;
        text-transform: none;
        color: var(--ink);
      }

      .wires-note p {
        margin: 4px 0 0;
        font-family: var(--font);
        font-size: clamp(10.5px, 2.2cqw, 14px);
        font-style: normal;
        font-weight: 400;
        line-height: 1.5;
        color: var(--ink-dim);
      }

      .wires[data-hot='gauge'] .wires-note[data-thread='gauge'] p,
      .wires[data-hot='edition'] .wires-note[data-thread='edition'] p,
      .wires[data-hot='hed'] .wires-note[data-thread='hed'] p {
        color: var(--ink);
      }

      @container (max-width: 460px) {
        .wires-board {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto;
          row-gap: 10px;
        }

        /* the paper's own panel spans the note, not the comments below it */
        .wires-board::before {
          grid-column: 1;
          grid-row: 1 / span 2;
        }

        .wires-head {
          grid-column: 1;
          grid-row: 1;
        }

        .wires-copy {
          grid-column: 1;
          grid-row: 2;
        }

        .wires-margin {
          grid-column: 1;
          grid-row: 3;
          padding-top: 2px;
        }

        /* two comments side by side under the note reads as a caption row rather
           than as a second column of prose */
        .wires-margin {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
      }

      @container (max-height: 240px) {
        .wires-head,
        .wires-bar-label {
          display: none;
        }

        .wires-copy {
          padding: 12px 14px;
          font-size: 0.78rem;
          line-height: 1.55;
        }

        .wires-margin {
          padding-top: 12px;
          gap: 6px;
        }

        .wires-note p {
          display: none;
        }
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('wires', GLIDE, 'GLIDE');
tuneSeconds('wires', 0.28, 'Step 1 duration');
tuneSeconds('wires', 0.32, 'Step 2 duration');

export class WiresDemo extends GalleryDemo {
  static stage = Wires;
  static notes = WiresNotes;
}
