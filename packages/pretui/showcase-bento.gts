// Pretui — the showcase's category mosaic: one tile per category, sized by
// how many components it holds, each running a small live demo.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { Rating } from './components/rating';
import { Switch } from './components/switch';
import { Sparkline } from './components/sparkline';
import { TaskRow } from './components/task-row';
import { TextShimmer } from './components/text-shimmer';
import { StatusChip } from './components/status-chip';
import { Kbd } from './components/kbd';
import { ProgressBar } from './components/progress-bar';
import { AngleDial } from './components/angle-dial';
import { TextRotate } from './components/text-rotate';
import { SegmentedControl } from './components/segmented-control';
import { Button } from './components/button';
import { CATEGORIES, type ShowcaseCategory } from './showcase-data';
import type { SpecCatalog } from './showcase-chrome';

const TREND = [4, 6, 5, 8, 7, 10, 9, 12, 14, 13, 16];
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'usage', label: 'Usage' },
  { value: 'api', label: 'API' },
];
const MOTION_WORDS = ['rises', 'shimmers', 'morphs', 'settles'];

// how many grid cells each tile spans: the big categories get the room
const SPANS: Record<string, string> = {
  inputs: 'wide tall',
  'data-display': 'wide',
  agentic: 'tall',
};

interface TileSignature {
  Args: {
    category: ShowcaseCategory;
    specs: SpecCatalog;
    onBrowse: (category?: string) => void;
  };
}

class Tile extends Component<TileSignature> {
  open = () => this.args.onBrowse(this.args.category.name);
  get span() {
    return SPANS[this.args.category.slug] ?? '';
  }
  get count() {
    return this.args.specs.count(this.args.category.name);
  }
  get slug() {
    return this.args.category.slug;
  }
  is = (slug: string) => this.slug === slug;
  <template>
    <div
      class='tile {{this.span}}'
      data-category={{this.slug}}
      data-test-showcase-tile={{this.slug}}
    >
      <div class='tile-demo' aria-hidden='true' inert>
        {{#if (this.is 'inputs')}}
          <div class='demo-stack'>
            <Rating @defaultValue={{4}} @label='Rating' />
            <div class='demo-row'>
              <Switch @defaultChecked={{true}} />
              <SegmentedControl
                @label='View'
                @options={{TABS}}
                @defaultValue='usage'
              />
            </div>
          </div>
        {{else if (this.is 'data-display')}}
          <div class='demo-figure'>
            <span class='demo-num'>2,418</span>
            <Sparkline
              @values={{TREND}}
              @label='Weekly signups'
              @kind='area'
              @width={{180}}
              @height={{40}}
              @showLast={{true}}
            />
          </div>
        {{else if (this.is 'agentic')}}
          <div class='demo-stack'>
            <TextShimmer @text='Thinking through 14 files…' />
            <TaskRow @state='completed' @label='Summarised the thread' />
            <TaskRow @state='running' @index={{2}} @label='Drafting reply' />
          </div>
        {{else if (this.is 'foundations')}}
          <div class='demo-row wrap'>
            <StatusChip @value='live' />
            <StatusChip @value='review' />
            <StatusChip @value='planned' />
            <Kbd @value='mod+k' />
          </div>
        {{else if (this.is 'feedback')}}
          <div class='demo-stack'>
            <ProgressBar @value={{72}} @label='Uploading' @count='18 of 25' />
          </div>
        {{else if (this.is 'authoring-tools')}}
          <AngleDial
            @defaultValue={{135}}
            @label='Angle'
            @showInput={{false}}
          />
        {{else if (this.is 'motion-effects')}}
          <p class='demo-motion'>Every surface
            <TextRotate @words={{MOTION_WORDS}} @interval={{1.6}} /></p>
        {{else if (this.is 'navigation')}}
          <SegmentedControl
            @label='Section'
            @options={{TABS}}
            @defaultValue='overview'
          />
        {{else if (this.is 'actions')}}
          <div class='demo-row'>
            <Button @variant='primary' @size='sm'>Publish</Button>
            <Button @variant='secondary' @size='sm'>Preview</Button>
          </div>
        {{else if (this.is 'overlays')}}
          <div class='demo-palette'>
            <div class='demo-palette-field'>Search commands
              <Kbd @value='mod+k' /></div>
            <div class='demo-palette-row on'>New card</div>
            <div class='demo-palette-row'>Open realm</div>
          </div>
        {{else if (this.is 'media')}}
          <div class='demo-wave'>
            {{#each WAVE as |h|}}<i style={{barStyle h}}></i>{{/each}}
          </div>
        {{else if (this.is 'layout')}}
          <div class='demo-layout'><i class='a'></i><i class='b'></i><i
              class='c'
            ></i><i class='d'></i></div>
        {{else if (this.is 'forms')}}
          <div class='demo-form'>
            <i class='label'></i><i class='field'></i>
            <i class='label short'></i><i class='field'></i>
          </div>
        {{else}}
          <div class='demo-cards'><i></i><i></i><i></i></div>
        {{/if}}
      </div>
      <button
        type='button'
        class='tile-open'
        data-test-showcase-tile-open
        {{on 'click' this.open}}
      >
        <span class='tile-meta'>
          <span class='tile-name'>{{@category.name}}</span>
          {{#if this.count}}<span
              class='tile-count'
            >{{this.count}}</span>{{/if}}
        </span>
        <span class='tile-blurb'>{{@category.blurb}}</span>
      </button>
    </div>
  </template>
}

const WAVE = [6, 14, 22, 12, 28, 18, 34, 20, 10, 26, 16, 30, 12, 8, 20, 14];
function barStyle(h: number) {
  return htmlSafe(`--h: ${h}px`);
}

export class CategoryBento extends Component<{
  Args: {
    specs: SpecCatalog;
    onBrowse: (category?: string) => void;
  };
  Element: HTMLElement;
}> {
  categories = CATEGORIES;
  <template>
    <div class='bento' ...attributes>
      {{#each this.categories as |category|}}
        <Tile
          @category={{category}}
          @specs={{@specs}}
          @onBrowse={{@onBrowse}}
        />
      {{/each}}
    </div>
    <style scoped>
      .bento {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        grid-auto-rows: 12.5rem;
        grid-auto-flow: dense;
        gap: 0.875rem;
      }
      .bento :deep(.tile) {
        position: relative;
        width: 100%;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 0.25rem;
        padding: 1rem 1.125rem 1.125rem;
        border: 1px solid var(--border);
        border-radius: calc(var(--radius, 0.75rem) + 0.25rem);
        background: var(--card, var(--background));
        color: var(--foreground);
        text-decoration: none;
        overflow: hidden;
        transition:
          transform 0.25s ease,
          box-shadow 0.25s ease,
          border-color 0.25s ease;
      }
      .bento :deep(.tile:hover),
      .bento :deep(.tile:has(.tile-open:focus-visible)) {
        transform: translateY(-3px);
        border-color: color-mix(in oklab, var(--primary) 45%, var(--border));
        box-shadow: 0 18px 40px -22px
          color-mix(in oklab, var(--primary) 55%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        .bento :deep(.tile) {
          transition: none;
        }
        .bento :deep(.tile:hover) {
          transform: none;
        }
      }
      .bento :deep(.tile.wide) {
        grid-column: span 2;
      }
      .bento :deep(.tile.tall) {
        grid-row: span 2;
      }
      @container (max-width: 34rem) {
        .bento :deep(.tile.wide) {
          grid-column: span 1;
        }
      }
      .bento :deep(.tile-demo) {
        display: grid;
        place-items: center;
        min-height: 0;
        overflow: hidden;
        border-radius: var(--radius, 0.5rem);
        background:
          radial-gradient(
            120% 90% at 50% 0%,
            color-mix(in oklab, var(--primary) 9%, transparent),
            transparent 70%
          ),
          var(--muted, transparent);
        margin-bottom: 0.5rem;
        padding: 0.75rem;
      }
      .bento :deep(.tile:has(.tile-open:focus-visible)) {
        outline: 2px solid var(--ring, var(--primary));
        outline-offset: 2px;
      }
      .bento :deep(.tile-open) {
        display: grid;
        gap: 0.25rem;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .bento :deep(.tile-open:focus-visible) {
        outline: none;
      }
      /* the whole tile is the button's hit area */
      .bento :deep(.tile-open::after) {
        content: '';
        position: absolute;
        inset: 0;
      }
      .bento :deep(.tile-meta) {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .bento :deep(.tile-name) {
        font-weight: 650;
        letter-spacing: -0.01em;
      }
      .bento :deep(.tile-count) {
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .bento :deep(.tile-blurb) {
        display: block;
        font-size: 0.8125rem;
        line-height: 1.4;
        color: var(--muted-foreground);
      }
      .bento :deep(.demo-stack) {
        display: grid;
        gap: 0.5rem;
        width: 100%;
        max-width: 18rem;
      }
      .bento :deep(.demo-row) {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .bento :deep(.demo-row.wrap) {
        flex-wrap: wrap;
        justify-content: center;
      }
      .bento :deep(.demo-figure) {
        display: grid;
        gap: 0.25rem;
        justify-items: start;
      }
      .bento :deep(.demo-num) {
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .bento :deep(.demo-motion) {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 650;
        letter-spacing: -0.01em;
      }
      .bento :deep(.demo-palette) {
        width: 100%;
        max-width: 15rem;
        border: 1px solid var(--border);
        border-radius: var(--radius, 0.5rem);
        background: var(--popover, var(--background));
        box-shadow: 0 12px 30px -18px rgb(0 0 0 / 0.4);
        font-size: 0.75rem;
        overflow: hidden;
      }
      .bento :deep(.demo-palette-field) {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0.625rem;
        border-bottom: 1px solid var(--border);
        color: var(--muted-foreground);
      }
      .bento :deep(.demo-palette-row) {
        padding: 0.375rem 0.625rem;
      }
      .bento :deep(.demo-palette-row.on) {
        background: var(--accent, var(--muted));
      }
      .bento :deep(.demo-wave) {
        display: flex;
        align-items: center;
        gap: 3px;
        height: 3rem;
      }
      .bento :deep(.demo-wave i) {
        width: 4px;
        height: var(--h);
        border-radius: 2px;
        background: var(--primary);
        animation: demo-wave 1.4s ease-in-out infinite alternate;
      }
      .bento :deep(.demo-wave i:nth-child(odd)) {
        animation-delay: -0.7s;
      }
      @keyframes demo-wave {
        to {
          transform: scaleY(0.45);
        }
      }
      .bento :deep(.demo-layout) {
        display: grid;
        grid-template: 'a a' 1rem 'b c' 2.5rem 'b d' 1.5rem / 2.5rem 6rem;
        gap: 4px;
      }
      .bento :deep(.demo-layout i),
      .bento :deep(.demo-form i),
      .bento :deep(.demo-cards i) {
        display: block;
        border-radius: 4px;
        background: color-mix(in oklab, var(--foreground) 12%, transparent);
      }
      .bento :deep(.demo-layout .a) {
        grid-area: a;
      }
      .bento :deep(.demo-layout .b) {
        grid-area: b;
        background: color-mix(in oklab, var(--primary) 35%, transparent);
      }
      .bento :deep(.demo-layout .c) {
        grid-area: c;
      }
      .bento :deep(.demo-layout .d) {
        grid-area: d;
      }
      .bento :deep(.demo-form) {
        display: grid;
        gap: 4px;
        width: 9rem;
      }
      .bento :deep(.demo-form .label) {
        height: 0.5rem;
        width: 50%;
      }
      .bento :deep(.demo-form .label.short) {
        width: 35%;
      }
      .bento :deep(.demo-form .field) {
        height: 1.5rem;
        margin-bottom: 0.375rem;
        background: transparent;
        border: 1px solid var(--border);
      }
      .bento :deep(.demo-cards) {
        display: grid;
        width: 8rem;
      }
      .bento :deep(.demo-cards i) {
        grid-area: 1 / 1;
        height: 3.5rem;
        background: var(--card, var(--background));
        border: 1px solid var(--border);
        box-shadow: 0 6px 16px -10px rgb(0 0 0 / 0.4);
      }
      .bento :deep(.demo-cards i:nth-child(1)) {
        transform: translate(-0.75rem, -0.75rem) rotate(-4deg);
      }
      .bento :deep(.demo-cards i:nth-child(3)) {
        transform: translate(0.75rem, 0.75rem) rotate(3deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .bento :deep(.demo-wave i) {
          animation: none;
        }
      }
    </style>
  </template>
}
