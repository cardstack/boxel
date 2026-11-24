// Pretui — the showcase home view: what the kit is, a live app that
// re-themes itself, the categories, the agentic set, and how to start.
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Odometer } from './components/odometer';
import { TextRotate } from './components/text-rotate';
import { CodeBlock } from './components/code-block';
import { Chip } from './components/chip';
import { InView } from './components/in-view';
import { ThemeStage } from './showcase-stage';
import { CategoryBento } from './showcase-bento';
import { SearchTotal, type SpecCatalog } from './showcase-chrome';
import { CATEGORIES, SPEC_REALM, THEME_REF } from './showcase-data';
import { AgentWall, FeaturedGallery } from './showcase-specimens';
import { StatusChip } from './components/status-chip';
import { Button } from './components/button';
import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

const LOOKS = ['every theme', 'light and dark', 'every card', 'your brand'];

const STEP_IMPORT = `import { Button } from '@cardstack/pretui/components/button';
import { StatusChip } from '@cardstack/pretui/components/status-chip';`;

const STEP_USE = `<template>
  <StatusChip @value={{@model.status}} />
  <Button @variant='primary' {{on 'click' this.approve}}>
    Approve
  </Button>
</template>`;

const STEP_THEME = `"relationships": {
  "cardInfo.theme": {
    "links": { "self": "@cardstack/catalog/Theme/riso" }
  }
}`;

export class HomeView extends GlimmerComponent<{
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    specs: SpecCatalog;
    tagline?: string | null;
    /** open the docs, on a category when one is given */
    onBrowse: (category?: string) => void;
    /** open one component's page in the docs */
    onOpen: (name: string, category: string) => void;
  };
}> {
  uid = guidFor(this);
  categoryCount = CATEGORIES.length;

  get themeTotalQuery(): SearchEntryWireQuery {
    return {
      ...searchEntryWireQueryFromQuery({
        filter: { type: THEME_REF },
        page: { number: 0, size: 1 },
      }),
      realms: [SPEC_REALM],
    };
  }
  browseAll = () => this.args.onBrowse();
  browseAgentic = () => this.args.onBrowse('Agentic');
  toQuickStart = (event: Event) => {
    let home = (event.currentTarget as HTMLElement).closest('.home');
    home?.querySelector('.quick-start')?.scrollIntoView({ behavior: 'smooth' });
  };
  get tagline() {
    return (
      this.args.tagline ??
      'A Boxel UI kit of typed, themeable components. Every one renders live in a card, follows any Theme card, and is ready to import.'
    );
  }

  <template>
    <div class='home'>
      <section class='hero' aria-labelledby='{{this.uid}}-title'>
        <div class='hero-copy'>
          <Chip @label='Boxel UI kit' @dot={{true}} />
          <h1 class='hero-title' id='{{this.uid}}-title'>One kit,<br />
            <span class='hero-rotate'><TextRotate
                @words={{LOOKS}}
                @interval={{2.4}}
              /></span></h1>
          <p class='hero-lede'>{{this.tagline}}</p>
          <div class='hero-ctas'>
            <button
              type='button'
              class='cta cta-primary'
              {{on 'click' this.browseAll}}
            >Browse components →</button>
            <button
              type='button'
              class='cta cta-ghost'
              {{on 'click' this.toQuickStart}}
            >Quick start</button>
          </div>
          <dl class='stats'>
            <div class='stat'>
              <dt>Components</dt>
              <dd>
                <Odometer
                  @value={{@specs.total}}
                  @duration={{1.2}}
                  @stagger={{0.08}}
                />
              </dd>
            </div>
            <div class='stat'>
              <dt>Categories</dt>
              <dd><Odometer
                  @value={{this.categoryCount}}
                  @duration={{1.2}}
                  @stagger={{0.08}}
                /></dd>
            </div>
            <div class='stat'>
              <dt>Themes</dt>
              <dd>
                <SearchTotal
                  @context={{@context}}
                  @query={{this.themeTotalQuery}}
                  as |n|
                >
                  <Odometer @value={{n}} @duration={{1.2}} @stagger={{0.08}} />
                </SearchTotal>
              </dd>
            </div>
          </dl>
        </div>
        <ThemeStage class='hero-stage' @context={{@context}} />
      </section>

      <InView @enter='rise'>
        <section class='band' aria-labelledby='{{this.uid}}-categories'>
          <div class='band-head'>
            <h2 id='{{this.uid}}-categories'>Find it by what it does</h2>
            <p>Fourteen categories. Each tile is the real component, running.</p>
          </div>
          <CategoryBento @specs={{@specs}} @onBrowse={{@onBrowse}} />
        </section>
      </InView>

      <section class='band agents' aria-labelledby='{{this.uid}}-agents'>
        <div class='agents-copy'>
          <span class='eyebrow'>Built for agents</span>
          <h2 id='{{this.uid}}-agents'>The parts of an AI product no other kit
            ships.</h2>
          <p>Thinking traces, staged diffs, questions, receipts and queues.
            Every one below is the real component, running. They follow the same
            tokens as the rest of the kit.</p>
          <button
            type='button'
            class='cta cta-primary'
            {{on 'click' this.browseAgentic}}
          >See all 22 →</button>
        </div>
        <AgentWall class='agents-wall' @onOpen={{@onOpen}} />
      </section>

      <section class='band' aria-labelledby='{{this.uid}}-featured'>
        <div class='band-head row'>
          <div>
            <span class='eyebrow'>Featured</span>
            <h2 id='{{this.uid}}-featured'>The ones cards reach for first</h2>
            <p>Try them here: each one is live.</p>
          </div>
          <button
            type='button'
            class='cta cta-ghost'
            {{on 'click' this.browseAll}}
          >All components →</button>
        </div>
        <FeaturedGallery @onOpen={{@onOpen}} />
      </section>

      <section
        class='band start quick-start'
        aria-labelledby='{{this.uid}}-start'
      >
        <div class='band-head'>
          <span class='eyebrow'>Quick start</span>
          <h2 id='{{this.uid}}-start'>From import to themed card in three steps</h2>
          <p>Pret UI is served as the realm
            <code>@cardstack/pretui/</code>. Any card can import from it.</p>
        </div>
        <ol class='steps'>
          <li class='step'>
            <div class='step-rail'><span class='step-n'>1</span></div>
            <div class='step-text'>
              <h3>Import what you need</h3>
              <p>One module per component, so a card loads only what it draws.</p>
            </div>
            <div class='step-code'>
              <CodeBlock
                @code={{STEP_IMPORT}}
                @language='ts'
                @filename='invoice.gts'
                @wrap={{true}}
              />
            </div>
          </li>
          <li class='step'>
            <div class='step-rail'><span class='step-n'>2</span></div>
            <div class='step-text'>
              <h3>Use it in a template</h3>
              <p>Typed arguments, sensible defaults, no wrapper markup.</p>
            </div>
            <div class='step-code'>
              <CodeBlock
                @code={{STEP_USE}}
                @language='hbs'
                @filename='invoice.gts'
                @wrap={{true}}
              />
              <div class='step-result'>
                <span class='step-result-cap'>Result</span>
                <div class='step-result-body'>
                  <StatusChip @value='overdue' />
                  <Button @variant='primary'>Approve</Button>
                </div>
              </div>
            </div>
          </li>
          <li class='step'>
            <div class='step-rail'><span class='step-n'>3</span></div>
            <div class='step-text'>
              <h3>Theme it</h3>
              <p>Link any Theme card. Every component reads only theme tokens,
                so color, radius and type all follow, in light and dark.</p>
            </div>
            <div class='step-code'>
              <CodeBlock
                @code={{STEP_THEME}}
                @language='json'
                @filename='Invoice/0042.json'
                @wrap={{true}}
              />
            </div>
          </li>
        </ol>
      </section>
    </div>
    <style scoped>
      .home {
        container-type: inline-size;
        min-height: 100%;
        background: var(--background);
        color: var(--foreground);
        font-family: var(--font-sans, inherit);
      }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.4fr);
        gap: 2.5rem;
        align-items: center;
        padding: 3.5rem 2.5rem 3rem;
        background:
          radial-gradient(
            60% 70% at 85% 10%,
            color-mix(in oklab, var(--primary) 14%, transparent),
            transparent 70%
          ),
          radial-gradient(
            50% 60% at 0% 100%,
            color-mix(
              in oklab,
              var(--chart-2, var(--primary)) 10%,
              transparent
            ),
            transparent 70%
          );
      }
      @container (max-width: 64rem) {
        .hero {
          grid-template-columns: minmax(0, 1fr);
          padding: 2.5rem 1.25rem;
        }
      }
      .hero-copy {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1.25rem;
        justify-items: start;
      }
      .hero-title {
        margin: 0;
        font-size: clamp(2.5rem, 6cqi, 4.25rem);
        line-height: 1.02;
        letter-spacing: -0.035em;
        font-weight: 750;
      }
      .hero-rotate {
        color: var(--primary);
      }
      .hero-lede {
        margin: 0;
        max-width: 32rem;
        font-size: 1.0625rem;
        line-height: 1.55;
        color: var(--muted-foreground);
      }
      .hero-ctas {
        display: flex;
        flex-wrap: wrap;
        gap: 0.625rem;
      }
      .cta {
        display: inline-flex;
        border: 0;
        font-family: inherit;
        cursor: pointer;
        align-items: center;
        height: 2.5rem;
        padding: 0 1.125rem;
        border-radius: var(--radius, 0.5rem);
        font-size: 0.9375rem;
        font-weight: 600;
        text-decoration: none;
      }
      .cta-primary {
        background: var(--primary);
        color: var(--primary-foreground);
      }
      .cta-primary:hover {
        background: color-mix(in oklab, var(--primary) 88%, var(--foreground));
      }
      .cta-ghost {
        border: 1px solid var(--border);
        color: var(--foreground);
        background: var(--background);
      }
      .cta-ghost:hover {
        background: var(--muted);
      }
      .stats {
        display: flex;
        gap: 2rem;
        margin: 0.5rem 0 0;
      }
      .stat {
        display: grid;
        gap: 0.125rem;
      }
      .stat dt {
        order: 2;
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .stat dd {
        margin: 0;
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        min-height: 2.5rem;
      }
      .band {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1.5rem;
        padding: 3rem 2.5rem;
        border-top: 1px solid var(--border);
      }
      @container (max-width: 64rem) {
        .band {
          padding: 2.5rem 1.25rem;
        }
      }
      .band-head {
        display: grid;
        gap: 0.375rem;
      }
      .band-head.row {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 1rem;
      }
      .band h2 {
        margin: 0;
        font-size: 1.75rem;
        letter-spacing: -0.02em;
        font-weight: 700;
      }
      .band-head p {
        margin: 0;
        color: var(--muted-foreground);
      }
      .eyebrow {
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--primary);
      }
      .agents {
        grid-template-columns: minmax(0, 1fr);
        gap: 2rem;
        background:
          radial-gradient(
            60% 80% at 100% 0%,
            color-mix(in oklab, var(--primary) 16%, transparent),
            transparent 70%
          ),
          color-mix(
            in oklab,
            var(--primary) 4%,
            var(--muted, var(--background))
          );
      }
      .agents-copy {
        display: grid;
        gap: 1rem;
        justify-items: start;
        max-width: 44rem;
      }
      .agents-copy p {
        margin: 0;
        line-height: 1.55;
        color: var(--muted-foreground);
      }
      .steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0;
      }
      .step {
        display: grid;
        grid-template-columns: 2.5rem minmax(0, 0.8fr) minmax(0, 1.6fr);
        gap: 0 1.5rem;
        padding-bottom: 2rem;
      }
      .step:last-child {
        padding-bottom: 0;
      }
      .step-rail {
        position: relative;
        display: flex;
        justify-content: center;
      }
      .step:not(:last-child) .step-rail::after {
        content: '';
        position: absolute;
        top: 2.25rem;
        bottom: -2rem;
        left: 50%;
        width: 1px;
        background: var(--border);
      }
      .step-n {
        display: inline-grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--background);
        font-size: 0.875rem;
        font-weight: 700;
      }
      .step-text h3 {
        margin: 0.375rem 0 0.375rem;
        font-size: 1.0625rem;
        letter-spacing: -0.01em;
      }
      .step-text p {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.5;
        color: var(--muted-foreground);
      }
      .step-code {
        display: grid;
        gap: 0.75rem;
        min-width: 0;
      }
      .step-result {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.875rem 1rem;
        border: 1px dashed var(--border);
        border-radius: var(--radius, 0.5rem);
      }
      .step-result-cap {
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .step-result-body {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      @container (max-width: 52rem) {
        .step {
          grid-template-columns: 2.5rem minmax(0, 1fr);
        }
        .step-code {
          grid-column: 2;
          margin-top: 0.75rem;
        }
      }
      code {
        font-family: var(--font-mono, monospace);
        font-size: 0.875em;
      }
    </style>
  </template>
}
