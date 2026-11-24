// Pretui — the showcase hero: a small working app built only from kit
// components, re-themed in place through the catalog's Theme cards.
//
// The realm forbids timers, so the theme cycle is driven by a CSS animation:
// every `animationiteration` of the progress line under the active chip
// advances to the next theme. Hovering pauses it, picking a theme stops it,
// and reduced motion never starts it.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';
import { Thinking } from './components/thinking';
import type { ThinkingRow } from './components/thinking';
import { StreamingText } from './components/streaming-text';
import { TaskRow } from './components/task-row';
import type { TaskRowDetail } from './components/task-row';
import { ApprovalFooter } from './components/approval-footer';
import { Composer } from './components/composer';
import { StatusChip } from './components/status-chip';
import { BarList } from './components/bar-list';
import type { BarListItem } from './components/bar-list';
import { Sparkline } from './components/sparkline';
import { Rating } from './components/rating';
import { ProgressBar } from './components/progress-bar';
import { Button } from './components/button';
import { SPEC_REALM, THEME_REF } from './showcase-data';

interface ThemeLike {
  id?: string;
  cardTitle?: string;
  cardDescription?: string;
  cssVariables?: string | null;
}

const THINKING: ThinkingRow[] = [
  { id: 't1', primary: 'Read the Q3 supplier sheet', state: 'done' },
  {
    id: 't2',
    primary: 'Matched 7 SKUs against open orders',
    secondary: 'orders.csv',
    mono: true,
    state: 'done',
  },
  {
    id: 't3',
    primary: 'Two suppliers are late on every order this quarter.',
    wrap: true,
  },
];

const RECEIPT: TaskRowDetail[] = [
  { id: 'r1', label: 'Hojicha, 1 kg', meta: '+24' },
  { id: 'r2', label: 'Genmaicha, 500 g', meta: '+40' },
];

const REGIONS: BarListItem[] = [
  { name: 'Lisbon', value: 4820 },
  { name: 'Kyoto', value: 3910 },
  { name: 'Oaxaca', value: 2675 },
  { name: 'Tbilisi', value: 1840 },
];

const TREND = [12, 14, 13, 17, 16, 19, 22, 21, 25, 27, 26, 31];

const ANSWER =
  'Reorder from Kyoto Leaf and Ume & Co. now; the other two suppliers can wait a week.';

export class ThemeStage extends Component<{
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
  };
  Element: HTMLElement;
}> {
  @tracked index = 0;
  @tracked paused = false;

  themesResource = this.args.context?.getCards?.(
    this,
    () => ({ filter: { type: THEME_REF } }),
    () => [SPEC_REALM],
  );

  // the last list that arrived: a live search can briefly come back empty
  // while it re-runs, and the tour should not blink out when it does
  private lastThemes: ThemeLike[] = [];
  get themes(): ThemeLike[] {
    let found = ((this.themesResource?.instances ?? []) as ThemeLike[]).filter(
      (t) => t.cssVariables,
    );
    if (found.length) {
      this.lastThemes = found;
    }
    return this.lastThemes;
  }
  get active(): ThemeLike | undefined {
    let themes = this.themes;
    return themes.length ? themes[this.index % themes.length] : undefined;
  }
  // a one-item list keyed on the theme, so the scene remounts, and replays
  // its entrance, each time the theme changes
  get activeList(): ThemeLike[] {
    return [this.active ?? { id: 'unthemed' }];
  }
  get position(): string {
    let n = this.themes.length;
    return n ? `${(this.index % n) + 1} / ${n}` : '';
  }
  get cycling(): boolean {
    return !this.paused && this.themes.length > 1;
  }
  get scopeId(): string {
    return (
      themeScope(this.active?.id, this.active?.cssVariables ?? undefined) ??
      guidFor(this)
    );
  }

  step = (by: number) => {
    let n = this.themes.length;
    if (n) {
      this.index = (this.index + by + n) % n;
    }
  };
  advance = () => {
    if (this.cycling) {
      this.step(1);
    }
  };
  prev = () => {
    this.paused = true;
    this.step(-1);
  };
  next = () => {
    this.paused = true;
    this.step(1);
  };
  togglePlay = () => (this.paused = !this.paused);
  noop = () => {};

  <template>
    <section class='stage' aria-label='Pret UI under every catalog theme'>
      {{#if this.active}}
        <div class='picker'>
          <button
            type='button'
            class='picker-step'
            aria-label='Previous theme'
            {{on 'click' this.prev}}
          >‹</button>
          <div class='picker-body' aria-live='polite'>
            <div class='picker-line'>
              <span class='picker-cap'>Theme</span>
              <span class='picker-name'>{{this.active.cardTitle}}</span>
              <span class='picker-pos'>{{this.position}}</span>
            </div>
            {{#if this.active.cardDescription}}
              <p class='picker-desc'>{{this.active.cardDescription}}</p>
            {{/if}}
            <span class='picker-track' aria-hidden='true'>
              {{#if this.cycling}}
                {{#each this.activeList key='id'}}
                  <span
                    class='picker-tick'
                    {{on 'animationiteration' this.advance}}
                  ></span>
                {{/each}}
              {{/if}}
            </span>
          </div>
          <button
            type='button'
            class='picker-step'
            aria-label='Next theme'
            {{on 'click' this.next}}
          >›</button>
          <button
            type='button'
            class='picker-play'
            aria-pressed={{if this.paused 'false' 'true'}}
            aria-label={{if
              this.paused
              'Play the theme tour'
              'Pause the theme tour'
            }}
            {{on 'click' this.togglePlay}}
          >{{if this.paused '▶' '❚❚'}}</button>
        </div>
      {{/if}}

      <div class='stage-frame'>
        <div
          class='stage-surface'
          data-boxel-theme-scope={{if this.active.cssVariables this.scopeId}}
        >
          {{#if this.active.cssVariables}}
            {{! template-lint-disable require-scoped-style }}
            <style data-boxel-theme-style>
              {{themeScopedCss this.scopeId this.active.cssVariables}}
            </style>
            {{! template-lint-enable require-scoped-style }}
          {{/if}}
          <div class='window-bar' aria-hidden='true'>
            <span class='dots'><i></i><i></i><i></i></span>
            <span class='window-title'>Supplier desk</span>
          </div>
          {{#each this.activeList key='id'}}
            <div class='scene'>
              <div class='scene-agent'>
                <div class='scene-cap'>
                  <span>Agent</span>
                  <StatusChip @value='running' />
                </div>
                <Thinking
                  @doneLabel='Thought for 6 seconds'
                  @rows={{THINKING}}
                  @defaultExpanded={{true}}
                />
                <p class='scene-answer'><StreamingText
                    @text={{ANSWER}}
                    @rate={{14}}
                  /></p>
                <div class='scene-tasks'>
                  <TaskRow
                    @state='completed'
                    @label='Reorder Kyoto Leaf'
                    @amount='64 kg'
                    @details={{RECEIPT}}
                  />
                  <TaskRow
                    @state='running'
                    @index={{2}}
                    @label='Email Ume & Co. for lead times'
                  />
                  <TaskRow
                    @state='pending'
                    @index={{3}}
                    @label='Update the supplier board'
                  />
                </div>
                <ApprovalFooter
                  @count={{3}}
                  @message='3 changes ready'
                  @onKeep={{this.noop}}
                  @onRevert={{this.noop}}
                  @onAcceptAll={{this.noop}}
                />
                <Composer @placeholder='Ask about your suppliers…' />
              </div>

              <div class='scene-work'>
                <div class='scene-card scene-kpi'>
                  <div class='scene-cap'>
                    <span>Revenue, last 12 weeks</span>
                    <StatusChip @value='on track' />
                  </div>
                  <div class='scene-figure'>$13,245</div>
                  <Sparkline
                    @values={{TREND}}
                    @label='Revenue, last 12 weeks'
                    @kind='area'
                    @width={{260}}
                    @height={{48}}
                    @showLast={{true}}
                  />
                </div>
                <div class='scene-card'>
                  <div class='scene-cap'><span>By city</span></div>
                  <BarList @rows={{REGIONS}} @label='Revenue by city' />
                </div>
                <div class='scene-card scene-row'>
                  <div>
                    <div class='scene-cap'><span>Supplier score</span></div>
                    <Rating @defaultValue={{4}} @label='Supplier score' />
                  </div>
                  <div class='scene-grow'>
                    <ProgressBar
                      @value={{68}}
                      @label='Reorders sent'
                      @count='17 of 25'
                    />
                  </div>
                </div>
                <div class='scene-actions'>
                  <Button @variant='primary'>Approve reorder</Button>
                  <Button @variant='secondary'>Open board</Button>
                </div>
              </div>
            </div>
          {{/each}}
        </div>
      </div>
    </section>
    <style scoped>
      .stage {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.75rem;
        min-width: 0;
        container-type: inline-size;
      }
      .picker {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--border);
        border-radius: calc(var(--radius, 0.75rem) + 0.25rem);
        background: color-mix(in oklab, var(--background) 80%, transparent);
        backdrop-filter: blur(8px);
      }
      .picker-step,
      .picker-play {
        display: inline-grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--background);
        color: var(--foreground);
        font: inherit;
        font-size: 1.125rem;
        line-height: 1;
        cursor: pointer;
      }
      .picker-play {
        font-size: 0.625rem;
        letter-spacing: -0.1em;
      }
      .picker-step:hover,
      .picker-play:hover {
        border-color: var(--foreground);
      }
      .picker-body {
        position: relative;
        display: grid;
        gap: 0.125rem;
        min-width: 0;
        padding: 0 0.25rem 0.375rem;
      }
      .picker-line {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        min-width: 0;
      }
      .picker-cap {
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .picker-name {
        font-weight: 700;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .picker-pos {
        margin-left: auto;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .picker-desc {
        margin: 0;
        font-size: 0.75rem;
        color: var(--muted-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .picker-track {
        position: absolute;
        left: 0.25rem;
        right: 0.25rem;
        bottom: 0;
        height: 2px;
        border-radius: 2px;
        background: color-mix(in oklab, var(--foreground) 10%, transparent);
        overflow: hidden;
      }
      .picker-tick {
        position: absolute;
        inset: 0;
        background: var(--primary);
        transform-origin: left;
        animation: picker-tick 5s linear infinite;
      }
      .stage:hover .picker-tick,
      .stage:focus-within .picker-tick {
        animation-play-state: paused;
      }
      @keyframes picker-tick {
        from {
          transform: scaleX(0);
        }
        to {
          transform: scaleX(1);
        }
      }
      .stage-surface {
        border-radius: calc(var(--radius, 0.75rem) + 0.375rem);
        border: 1px solid var(--border);
        background: var(--muted, var(--background));
        color: var(--foreground);
        font-family: var(--font-sans, inherit);
        overflow: hidden;
        box-shadow: var(--shadow-lg, 0 24px 60px -24px rgb(0 0 0 / 0.35));
      }
      .window-bar {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.875rem;
        border-bottom: 1px solid var(--border);
        background: var(--card, var(--background));
      }
      .dots {
        display: inline-flex;
        gap: 0.375rem;
      }
      .dots i {
        width: 0.625rem;
        height: 0.625rem;
        border-radius: 999px;
        background: color-mix(in oklab, var(--foreground) 18%, transparent);
      }
      .dots i:first-child {
        background: var(--primary);
      }
      .window-title {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--muted-foreground);
      }
      .scene {
        animation: scene-in 0.45s ease both;
      }
      @keyframes scene-in {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .picker-tick {
          animation: none;
        }
        .scene {
          animation: none;
        }
      }
      .scene {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
        gap: 1rem;
        padding: 1rem;
      }
      .scene-agent,
      .scene-work {
        display: grid;
        gap: 0.75rem;
        align-content: start;
        min-width: 0;
      }
      .scene-agent {
        padding: 1rem;
        border-radius: var(--radius, 0.75rem);
        background: var(--card, var(--background));
        border: 1px solid var(--border);
      }
      .scene-card {
        padding: 0.875rem 1rem;
        border-radius: var(--radius, 0.75rem);
        background: var(--card, var(--background));
        border: 1px solid var(--border);
        display: grid;
        gap: 0.5rem;
        min-width: 0;
      }
      .scene-row {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: end;
        gap: 1.25rem;
      }
      .scene-cap {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground);
      }
      .scene-figure {
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .scene-answer {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.5;
      }
      .scene-tasks {
        display: grid;
        gap: 0.375rem;
      }
      .scene-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
      }
      @container (max-width: 720px) {
        .scene {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    </style>
  </template>
}
