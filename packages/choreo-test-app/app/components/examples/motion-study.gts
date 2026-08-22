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
 * details fade FIRST, the cards move THEN — the ones that stay put held behind
 * the one that grows — and the new details fade in LAST.
 */
export class MotionStudy extends Component {
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
            {{motion id=card.id role="card"}}
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
          <c.Parallel>
            <c.Hold @of={{c.role "card"}} @zIndex={{1}} />
            <c.Hold @of={{c.removed "card-content"}} @zIndex={{2}} />
            <c.Tween
              @of={{c.removed "card-content"}}
              @opacity={{0}}
              @ms={{220}}
            />
          </c.Parallel>
          <c.Parallel>
            <c.Move @of={{c.moved "card"}} @spring={{soft}} />
            <c.Hold @of={{c.still "card"}} @zIndex={{0}} />
          </c.Parallel>
          <c.Tween
            @of={{c.inserted "card-content"}}
            @opacity={{1}}
            @from={{from0}}
            @ms={{260}}
          />
        </c.Sequence>
      </Choreo>
    </div>
  </template>
}

function isOpen(card: Card, open: Card['id'] | null) {
  return card.id === open;
}
function detailsId(card: Card) {
  return `${card.id}-details`;
}
function wash(card: Card) {
  return `--wash: ${card.wash}`;
}
