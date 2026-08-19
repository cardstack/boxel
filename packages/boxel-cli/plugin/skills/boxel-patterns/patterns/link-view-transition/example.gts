import {
  CardDef,
  Component,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { get } from '@ember/helper';

// Replace with your own child CardDef.
import { SampleCard } from './sample-card';

// 🧩 PATTERN: View Transitions API for free morph animations.
//
// `document.startViewTransition(() => mutate())` tells the browser to
// snapshot the DOM, run your callback synchronously, snapshot again,
// then crossfade between the two snapshots. Add `view-transition-name`
// to elements with stable identity across the change — same name on
// both sides → the browser interpolates position, size, opacity, and
// clipping instead of crossfading. No animation code on the JS side.

export class Gallery extends CardDef {
  static displayName = 'Gallery';
  static prefersWideFormat = true;

  @field items = linksToMany(SampleCard, { query: {} });

  static isolated = class Isolated extends Component<typeof Gallery> {
    @tracked order: number[] | null = null;

    get displayIndices(): number[] {
      const n = this.args.model.items?.length ?? 0;
      return this.order && this.order.length === n
        ? this.order
        : Array.from({ length: n }, (_, i) => i);
    }

    @action shuffle() {
      const n = this.args.model.items?.length ?? 0;
      const next = Array.from({ length: n }, (_, i) => i);
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      this.applyChange(() => {
        this.order = next;
      });
    }

    private applyChange(mutate: () => void) {
      // Feature-detect — older browsers fall back to an instant change.
      if (typeof document.startViewTransition === 'function') {
        document.startViewTransition(mutate);
      } else {
        mutate();
      }
    }

    <template>
      <section class='gallery'>
        <header>
          <h1>{{@model.title}}</h1>
          <button type='button' {{on 'click' this.shuffle}}>
            Shuffle
          </button>
        </header>

        <div class='grid'>
          {{#each this.displayIndices as |i|}}
            {{#let (get @model.items i) as |card|}}
              {{! Stable view-transition-name keyed by card id makes
                  the browser interpolate position between snapshots. }}
              <div
                class='cell'
                style='view-transition-name: gallery-{{card.id}}'
              >
                {{#let (get @fields.items i) as |CardField|}}
                  <CardField @format='fitted' />
                {{/let}}
              </div>
            {{/let}}
          {{/each}}
        </div>
      </section>

      <style scoped>
        .gallery {
          padding: 2rem;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 1.5rem;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 1rem;
          /* The whole grid container is also a transition target.
             Naming it morphs the container itself, not just children. */
          view-transition-name: gallery-grid;
        }
        .cell {
          aspect-ratio: 3 / 4;
        }

        /* Per-element keyframes for the auto-generated pseudo-elements
           let you override the default crossfade. The browser inserts
           ::view-transition-old(NAME) and ::view-transition-new(NAME)
           pseudo-elements during each transition. */
        ::view-transition-group(gallery-grid) {
          animation-duration: 0.45s;
        }
      </style>
    </template>
  };
}

// --- Gotchas ---
//
// - Name collisions. Two elements with the same `view-transition-name`
//   in one snapshot fall back to a crossfade silently. Always key the
//   name with a stable id (card.id, not the array index).
//
// - Snapshot is synchronous. The callback you pass runs between the
//   two snapshots. Don't `await` data fetches inside — resolve first,
//   then call `startViewTransition`.
//
// - Concurrent transitions cancel. Firing another transition before
//   `transition.finished` resolves cancels the previous one.
//
// - SSR / prerender. `document.startViewTransition` isn't present
//   outside a browser context — feature-detect protects you.
