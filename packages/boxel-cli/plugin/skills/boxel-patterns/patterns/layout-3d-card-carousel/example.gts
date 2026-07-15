import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type Query,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { gt } from '@cardstack/boxel-ui/helpers';
import CubeIcon from '@cardstack/boxel-icons/cube';

// Replace this with the CardDef you want to display on the cylinder.
import { TradingCard } from './trading-card';

// 🧩 PATTERN: 3D card carousel driven by @context.searchResultsComponent.
//
// For n cards at index i, the angle is `i / n * 360deg`. Each slot
// gets `--card-index` and `--total-cards` as CSS variables; the slot's
// transform reads them and resolves to
// `rotateY(angle) translateZ(radius) rotateY(-angle)` — placing the
// card on a virtual cylinder and counter-rotating so the face still
// looks at the camera.
//
// The wrapping container has `transform-style: preserve-3d` and a
// `perspective` so the camera sees depth. Rotate the cylinder element
// to spin the whole carousel; rotate the stage to tilt the camera.

export class CardCarousel extends CardDef {
  static displayName = 'Card Carousel';
  static icon = CubeIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);

  static isolated = class Isolated extends Component<typeof CardCarousel> {
    @tracked isRotating = false;

    // Filter by `type:` to select all instances of the CardDef. Using
    // `on:` alone here would silently return zero rows — see
    // boxel/references/query-systems.md.
    get query(): Query {
      return {
        filter: {
          type: codeRef(import.meta.url, './trading-card', 'TradingCard'),
        },
        sort: [{ by: 'cardURL', direction: 'asc' }],
      };
    }

    get realms(): string[] {
      // realmURL is a Symbol imported from @cardstack/runtime-common.
      // Don't write Symbol.for('realmURL') — different Symbol, silent
      // zero-rows.
      const r = this.args.model[realmURL];
      return r ? [String(r)] : [];
    }

    // Fold the legacy Query into a search-entry query: attach the realms
    // and pin the fitted format. Search-entry queries are live by
    // default, so there's no @isLive to set.
    get searchQuery(): SearchEntryWireQuery {
      const q = searchEntryWireQueryFromQuery(this.query);
      return {
        ...q,
        realms: this.realms,
        filter: {
          ...q.filter,
          eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
        },
      };
    }

    toggleRotate = () => {
      this.isRotating = !this.isRotating;
    };

    <template>
      <div class='stage'>
        <header>
          <h1>{{if @model.title @model.title 'Carousel'}}</h1>
          <button type='button' {{on 'click' this.toggleRotate}}>
            {{if this.isRotating 'Stop' 'Auto-rotate'}}
          </button>
        </header>

        <div class='cylinder {{if this.isRotating "spinning"}}'>
          {{! @overlays={{false}} — the carousel lays results out on the
              cylinder itself, so it wants plain rendering with no
              operator-mode overlay chrome interfering with the 3D
              transforms. }}
          <@context.searchResultsComponent
            @query={{this.searchQuery}}
            @mode='hover'
            @overlays={{false}}
            as |results|
          >
            {{#if results.isLoading}}
              <div class='empty'>Loading…</div>
            {{/if}}
            {{#if (gt results.entries.length 0)}}
              {{#each results.entries key='id' as |entry index|}}
                <div
                  class='slot'
                  style='--card-index: {{index}}; --total-cards: {{results.entries.length}}'
                >
                  <entry.component />
                </div>
              {{/each}}
            {{else}}
              {{#unless results.isLoading}}
                <div class='empty'>No cards yet.</div>
              {{/unless}}
            {{/if}}
          </@context.searchResultsComponent>
        </div>
      </div>

      <style scoped>
        .stage {
          width: 100%;
          height: 100%;
          /* Camera distance. Smaller = more dramatic perspective. */
          perspective: 1200px;
          perspective-origin: 50% 45%;
          background: var(--background, #0f172a);
          color: var(--foreground, #e2e8f0);
          overflow: hidden;
          position: relative;
        }

        header {
          position: absolute;
          inset-block-start: 1rem;
          inset-inline: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          z-index: 2;
        }

        .cylinder {
          position: absolute;
          inset: 0;
          /* preserve-3d does NOT inherit. Every layer between the
             perspective ancestor and the rotated slot needs it. */
          transform-style: preserve-3d;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.4s ease;
        }

        .cylinder.spinning {
          animation: spin 20s linear infinite;
        }

        .slot {
          position: absolute;
          width: 170px;
          height: 250px;
          transform-style: preserve-3d;

          /* Circular placement formula:
             - angle: i / n × 360deg, advances around the cylinder
             - radius: scales with card count so they don't overlap
             - the trailing rotateY(-angle) counter-rotates the slot
               so each card's face still looks at the camera */
          --angle: calc((360deg / var(--total-cards)) * var(--card-index));
          --radius: max(300px, calc(var(--total-cards) * 30px));

          transform:
            rotateY(var(--angle))
            translateZ(var(--radius))
            rotateY(calc(var(--angle) * -1));

          transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .slot:hover {
          transform:
            rotateY(var(--angle))
            translateZ(calc(var(--radius) + 50px))
            rotateY(calc(var(--angle) * -1))
            scale(1.1);
        }

        .empty {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
        }

        @keyframes spin {
          from { transform: rotateY(0deg); }
          to   { transform: rotateY(360deg); }
        }
      </style>
    </template>
  };
}

// --- Gotchas ---
//
// - `transform-style: preserve-3d` does NOT inherit. Every layer
//   between the perspective ancestor and the rotated slot needs it,
//   or children flatten to 2D.
//
// - `overflow: hidden` on the perspective element is fine; on
//   intermediate `transform-style: preserve-3d` layers it can
//   silently flatten the 3D context. Put any clipping on a sibling.
//
// - Per-card vars on the wrong element. `--card-index` must be on
//   the slot (the element the transform targets), not the inner
//   card. If your card has a chrome wrapper, the var rides on the
//   outer slot.
//
// - Liveness. Search-entry queries are live by default — the carousel
//   re-fetches on every realm change, no flag to toggle. If you need a
//   snapshot, freeze the entries once yielded rather than re-deriving.
//
// - Card chrome breaks immersion. searchResultsComponent entries can
//   come with operator-mode overlays plus CardContainer chrome
//   (rounded corners, halo). Pass `@overlays={{false}}` to drop the
//   overlay, and for a clean carousel look use `@displayContainer={{false}}`
//   per card or recolor the chrome via `:deep(.boxel-card-container)` from
//   scoped CSS — see boxel-ui-guidelines/references/delegated-render-control.md.
