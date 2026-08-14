import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { concat } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

import type { Ticket } from '../ticket';
import { slaClock } from '../utils/sla-clock';
import {
  LENSES,
  matchesLens,
  isLiveWork,
  type Lens,
  type LensSpec,
} from '../utils/queue-lens';

interface RailLens extends LensSpec {
  count: number;
}

interface RailQueue {
  name: string;
  count: number;
}

interface Signature {
  Args: {
    tickets: Ticket[];
    lens: Lens;
    onLens: (lens: Lens) => void;
    queueName?: string;
    onQueue: (queueName: string | undefined) => void;
  };
  Element: HTMLElement;
}

/**
 * The standing rail: what is on me, and which basket is drowning.
 *
 * It replaces a horizontal strip of the same six numbers above the list. The
 * strip worked, but it competed with the list for the top of the reading
 * order and it had nowhere to put the queue breakdown — so the two questions
 * an agent opens the console to ask ("what is on fire" and "whose is it")
 * could not sit side by side. In a rail they do, permanently, and the list
 * keeps its own top edge for the rows.
 *
 * Every number here is also the filter that produces it. A count you read and
 * then have to go re-find is two gestures for one intent.
 */
export class WorkRail extends GlimmerComponent<Signature> {
  // The counts are now computed against the live clock (see `matchesLens`), so
  // this component is a clock watcher in its own right. Without the
  // subscription the interval only runs while some badge happens to be
  // mounted, and a rail beside an empty list would freeze its own numbers.
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args as never);
    slaClock.subscribe();
  }

  willDestroy() {
    super.willDestroy();
    slaClock.unsubscribe();
  }

  get all(): Ticket[] {
    return (this.args.tickets ?? []).filter(Boolean);
  }

  get lenses(): RailLens[] {
    return LENSES.map((spec) => ({
      ...spec,
      count: this.all.filter((ticket) => matchesLens(ticket, spec.key)).length,
    }));
  }

  // Derived from the tickets themselves rather than from a Queue query: a
  // queue with nothing in it is not a row an agent needs, and a ticket whose
  // queue was deleted still has to appear somewhere.
  get queues(): RailQueue[] {
    let counts = new Map<string, number>();
    for (let ticket of this.all) {
      if (!isLiveWork(ticket)) {
        continue;
      }
      let name = ticket.queueName?.trim() || 'Unrouted';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  pickLens = (lens: Lens, _event?: Event) => {
    this.args.onLens(lens);
  };

  pickQueue = (name: string, _event?: Event) => {
    this.args.onQueue(this.args.queueName === name ? undefined : name);
  };

  <template>
    <nav class='rail' aria-label='Work filters' ...attributes>
      <section class='grp'>
        <h2 class='grp-h'>My work</h2>
        <ul class='items'>
          {{#each this.lenses key='key' as |item|}}
            <li>
              {{! Raw button: each row is a count + a label acting as one
                  toggle, which is not a shape boxel-ui's Button renders. The
                  plain actions in this app all use Button. }}
              <button
                type='button'
                class='item
                  {{if item.tone (concat "tone-" item.tone)}}
                  {{if (eq item.key @lens) "item-on"}}'
                aria-current={{if (eq item.key @lens) 'true' 'false'}}
                title={{item.hint}}
                {{on 'click' (fn this.pickLens item.key)}}
              >
                <span class='item-n'>{{item.count}}</span>
                <span class='item-l'>{{item.label}}</span>
              </button>
            </li>
          {{/each}}
        </ul>
      </section>

      {{#if this.queues.length}}
        <section class='grp'>
          <h2 class='grp-h'>Queues</h2>
          <ul class='items'>
            {{#each this.queues key='name' as |queue|}}
              <li>
                <button
                  type='button'
                  class='item {{if (eq queue.name @queueName) "item-on"}}'
                  aria-pressed={{if (eq queue.name @queueName) 'true' 'false'}}
                  {{on 'click' (fn this.pickQueue queue.name)}}
                >
                  <span class='item-n'>{{queue.count}}</span>
                  <span class='item-l'>{{queue.name}}</span>
                </button>
              </li>
            {{/each}}
          </ul>
        </section>
      {{/if}}
    </nav>

    <style scoped>
      .rail {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-width: 0;
        font-family: var(--font-sans, var(--boxel-font-family));
        color: var(--foreground, var(--boxel-dark));
      }
      .grp {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .grp-h {
        margin: 0 0 2px;
        font-size: 0.5625rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .items {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      /* No boxes and no dividers: the numbers are already a column, and a rule
         between each pair would draw six lines to separate six things that are
         separated by whitespace already. */
      .item {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        width: 100%;
        min-height: 28px;
        padding: 3px var(--boxel-sp-xs);
        border: none;
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: none;
        color: inherit;
        font-family: inherit;
        text-align: start;
        cursor: pointer;
        transition: background 0.1s ease-out;
      }
      .item:hover {
        background: var(--muted, var(--boxel-100));
      }
      .item:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .item-on {
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 12%,
          var(--background, var(--boxel-light))
        );
        box-shadow: inset 2px 0 0 var(--primary, var(--boxel-highlight));
      }
      /* Fixed-width tabular figures so the labels line up as a column even
         when one count reaches three digits. */
      .item-n {
        flex: none;
        width: 1.6rem;
        text-align: end;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .item-l {
        flex: 1;
        min-width: 0;
        font-size: var(--boxel-font-size-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Tone paints the figure only. A whole row in red would make the rail
         the loudest thing on screen, and the rail is where you look second. */
      .tone-bad .item-n {
        color: var(--boxel-danger);
      }
      .tone-warn .item-n {
        color: var(--boxel-warning);
      }
      .tone-ok .item-n {
        color: var(--boxel-success);
      }
      .tone-hold .item-n {
        color: var(--muted-foreground, var(--boxel-450));
      }

      /* Narrow: the rail lies down instead of disappearing. Two scrolling
         rows of counts still answer "what is on fire" and "whose is it" —
         which is the whole reason the rail exists. */
      @container (max-width: 68rem) {
        .rail {
          flex-direction: row;
          gap: var(--boxel-sp);
          overflow-x: auto;
        }
        .grp {
          flex: none;
        }
        .items {
          flex-direction: row;
          gap: 2px;
        }
        .item {
          width: auto;
          gap: 0.35em;
          white-space: nowrap;
        }
        .item-n {
          width: auto;
        }
      }

      /* Motion here is confirmation, never decoration — a hover tint, a
         pressed nudge. Someone who has asked the OS to stop animating gets
         the same interface with the confirmation delivered instantly. */
      @media (prefers-reduced-motion: reduce) {
        * {
          transition: none !important;
          animation: none !important;
        }
      }
    </style>
  </template>
}

export default WorkRail;
