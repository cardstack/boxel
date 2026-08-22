import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';

const cards = [
  {
    body: 'Held the last props. Clean handoff, no bounce on the landing.',
    heat: '1280°',
    id: 'atlas',
    label: 'Atlas',
    wash: 'linear-gradient(160deg, #ff7a45 0%, #c42712 42%, #2a0c08 100%)',
  },
  {
    body: 'Orange hold, then snap. The kiln door was open for the pour.',
    heat: '920°',
    id: 'ember',
    label: 'Ember',
    wash: 'linear-gradient(145deg, #ffb36a 0%, #ff3b1f 48%, #4a1208 100%)',
  },
  {
    body: 'Steel wash over the rack. Cooled overnight.',
    heat: '640°',
    id: 'flux',
    label: 'Flux',
    wash: 'linear-gradient(165deg, #c5cdd0 0%, #5c6568 40%, #1a1613 100%)',
  },
  {
    body: 'Clear after the pour; the glass took the light.',
    heat: '410°',
    id: 'halo',
    label: 'Halo',
    wash: 'linear-gradient(150deg, #fff4e8 0%, #e4a35a 45%, #5a3214 100%)',
  },
] as const;

type Card = (typeof cards)[number];

const soft = { bounce: 0.14, visualDuration: 0.48 };
const from0 = { opacity: 0 };

/**
 * boxel-motion's motion-study, on <Choreo>: open a card and the closing card's
 * details fade FIRST, the cards move THEN, and the new details fade in LAST —
 * with the card being opened held above the one it replaces for exactly as
 * long as the move takes.
 *
 * The move itself is `layout=true`, not `c.Move`: these cards are grid items,
 * and animating a grid item's width/height distorts every track around it
 * (boxel-motion filed this as CS-4174). Projection animates with transforms
 * only. Choreo sequences the phases and holds the layers.
 */
export class Sequence extends Component {
  @tracked open: Card['id'] | null = null;

  toggle = (card: Card) => {
    this.open = this.open === card.id ? null : card.id;
  };

  <template>
    <div class="ex">
      <Choreo class="study" as |c|>
        {{#each cards as |card|}}
          <button
            type="button"
            class={{if
              (isOpen card this.open)
              "study-card is-open"
              "study-card"
            }}
            style={{wash card}}
            {{motion
              id=card.id
              role=(roleOf card this.open)
              layout=true
              transition=soft
            }}
            {{on "click" (fn this.toggle card)}}
          >
            <span class="study-name">{{card.label}}</span>
            {{#if (isOpen card this.open)}}
              <span
                class="study-details"
                {{motion id=(detailsId card) role="card-content"}}
              >
                <b>{{card.heat}}</b>
                <span>{{card.body}}</span>
              </span>
            {{/if}}
          </button>
        {{/each}}

        <c.Sequence>
          {{! Layers, held for the rest of the sequence: the card being
              opened rides over the one it replaces, which rides over the
              shelf. Released the moment the sequence ends — no timers, no
              flags to clear. }}
          <c.Hold @of={{c.role "card"}} @zIndex={{1}} />
          <c.Hold @of={{c.role "hero"}} @zIndex={{2}} />

          <c.Parallel>
            {{! and inside the closing card, its details sit over its own
                background while they fade }}
            <c.Hold @of={{c.removed "card-content"}} @zIndex={{1}} />
            <c.Tween
              @of={{c.removed "card-content"}}
              @opacity={{0}}
              @ms={{220}}
            />
          </c.Parallel>

          {{! The geometry is projection's ({{motion layout=true}}): it moves
          and resizes with transforms alone, so a card in flight never distorts
          the grid its siblings are laid out in. Choreo owns the ordering and
          the layers around it. The Wait holds the sequence open for the length
          of that move; the new details fade in partway THROUGH it rather than
          after it, so the card arrives already carrying its content. }}
          <c.Parallel>
            <c.Wait @of={{c.all}} @ms={{560}} />
            <c.Tween
              @of={{c.inserted "card-content"}}
              @opacity={{1}}
              @from={{from0}}
              @delay={{170}}
              @ms={{300}}
            />
          </c.Parallel>
        </c.Sequence>
      </Choreo>
    </div>
  </template>
}

function isOpen(card: Card, open: Card['id'] | null) {
  return card.id === open;
}
/** the card being opened is its own role, so a step can lift it over the one it replaces */
function roleOf(card: Card, open: Card['id'] | null) {
  return card.id === open ? 'hero' : 'card';
}
function detailsId(card: Card) {
  return `${card.id}-details`;
}
function wash(card: Card) {
  return `--wash: ${card.wash}`;
}
