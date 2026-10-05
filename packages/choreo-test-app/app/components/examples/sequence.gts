import { Choreo } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';
import { tuneMotion, tuneSeconds } from 'test-app/lib/demo-tuning';

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

/**
 * boxel-motion's motion-study, on <Choreo>: open a card and the closing card's
 * details fade FIRST, the cards move THEN, and the new details fade in LAST —
 * with the card being opened held above the one it replaces for exactly as
 * long as the move takes.
 *
 * The move itself is `layout=true`, not `c.Move`: these cards are grid items,
 * and animating a grid item's width/height distorts every track around it
 * (a known limitation of the legacy model). Projection animates with transforms
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
            {{motion
              id=card.id
              role=(roleOf card this.open)
              layout=true
              transition=(tuneMotion "sequence" soft "soft")
              style=(cardStyle card)
            }}
            {{on "click" (fn this.toggle card)}}
          >
            {{! SCALE CORRECTION — not decoration, and easy to miss.

                The card's geometry is projection's: it goes from a square tile
                to a 16:9 hero by TRANSFORM, so scaleX and scaleY are wildly
                different, and everything inside inherits that scale. Text under
                a non-uniform scale is smeared — "Ember" comes out stretched.

                A child with its own `layout` is measured in its own right, and
                projection counteracts whatever scale its parent is applying.
                The label then animates between its two real font sizes instead
                of being rubber-sheeted by the box around it.

                It only reads as a clean scale because the box stays in
                proportion: same string, shrink-to-fit, so its width and height
                both track font-size and the aspect ratio never changes. The
                lightbox needed `width: fit-content` on BOTH members for exactly
                this reason — two boxes of different shape cannot scale into one
                another without distortion. }}
            <span
              class="study-name"
              {{motion
                layout=true
                transition=(tuneMotion "sequence" soft "soft")
              }}
            >
              {{card.label}}
            </span>
            {{#if (isOpen card this.open)}}
              {{! Deliberately NOT layout=true, though the smearing argument above
                  applies here too. These details carry a Choreo id, and the id
                  comes BACK every time the card is reopened — so a returning
                  one counterpart-matches the copy that is still fading out and
                  projection slides it in from that old seat instead of fading
                  it in fresh. The fade is worth more than the correction here. }}
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
              @duration={{tuneSeconds "sequence" 0.22 "Step 1 duration"}}
            />
          </c.Parallel>

          {{!-- The geometry is projection's ({{motion layout=true}}): it moves
          and resizes with transforms alone, so a card in flight never distorts
          the grid its siblings are laid out in. Choreo owns the ordering and
          the layers around it. The Wait holds the sequence open for the length
          of that move; the new details fade in partway THROUGH it rather than
          after it, so the card arrives already carrying its content. --}}
          <c.Parallel>
            <c.Wait
              @of={{c.all}}
              @duration={{tuneSeconds "sequence" 0.56 "Step 2 duration"}}
            />
            <c.Tween
              @of={{c.inserted "card-content"}}
              @opacity={{array 0 1}}
              @delay={{0.17}}
              @duration={{tuneSeconds "sequence" 0.3 "Step 3 duration"}}
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
/**
 * DECLARE WHAT YOU WANT TWEENED.
 *
 * `borderRadius` is here rather than in the stylesheet, and that is the whole
 * point. A layout animation moves this card by transform, so a square tile
 * becoming a 16:9 hero is being scaled unevenly — and a radius the engine does
 * not know about is scaled with everything else, which turns round corners into
 * ovals. It is worst exactly where it is most visible: a narrow viewport, a
 * heavily curved tile.
 *
 * Scale correction fixes it, and it can only correct values the element
 * actually has. A radius that lives in CSS is invisible to it. Hand the value
 * to Motion and every frame is corrected against the scale in force.
 *
 * The `--wash` custom property rides along for the same reason a style
 * attribute would be wrong here: Motion owns this element's inline style, and
 * a bound `style=` would be rewritten by Glimmer over the top of the transform.
 */
function cardStyle(card: Card) {
  return { '--wash': card.wash, borderRadius: '14px' };
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('sequence', soft, 'soft');
tuneSeconds('sequence', 0.22, 'Step 1 duration');
tuneSeconds('sequence', 0.56, 'Step 2 duration');
tuneSeconds('sequence', 0.3, 'Step 3 duration');
