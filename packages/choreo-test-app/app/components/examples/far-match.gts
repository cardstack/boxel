import { Choreo, type Sprite } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';
import { tuneSeconds, tuneSpring } from 'test-app/lib/demo-tuning';

const bays = [
  { id: 'kiln', label: 'Kiln' },
  { id: 'quench', label: 'Quench' },
  { id: 'rack', label: 'Rack' },
] as const;

const pieces = [
  {
    id: 'atlas',
    label: 'Atlas',
    wash: 'linear-gradient(160deg, #ff7a45 0%, #c42712 100%)',
  },
  {
    id: 'ember',
    label: 'Ember',
    wash: 'linear-gradient(145deg, #ffb36a 0%, #ff3b1f 100%)',
  },
  {
    id: 'flux',
    label: 'Flux',
    wash: 'linear-gradient(165deg, #c5cdd0 0%, #5c6568 100%)',
  },
  {
    id: 'halo',
    label: 'Halo',
    wash: 'linear-gradient(150deg, #fff4e8 0%, #e4a35a 100%)',
  },
] as const;

type Bay = (typeof bays)[number]['id'];
type Piece = (typeof pieces)[number];

/** every piece that is somewhere new, whether that is two bays over or one slot up */
const carry = { damping: 23, stiffness: 260 };
/** the bay itself growing or shrinking around what it holds */
const settle = { damping: 26, stiffness: 330 };

/**
 * Lift the piece that came from somewhere else over everything else on the
 * stage.
 *
 * A property may be a function of the sprite, and `counterpart` is exactly the
 * question being asked: this sprite is the receiving half of a far match, so it
 * is about to fly across two other bays, and it must pass over their panels
 * rather than under them. Everything else is just closing a gap inside its own
 * bay and can stay where it is.
 */
const layer = (sprite: Sprite) => (sprite.counterpart ? 6 : 1);

/**
 * Far matching — one identity, three scenes.
 *
 * Each bay is its own <Choreo>. That is not a technicality: a region reconciles
 * its own participants and nothing else, which is what makes nesting work and
 * what keeps a busy shell from re-deciding the whole page every time one panel
 * renders. The cost is that a piece leaving one region and appearing in another
 * is a death here and an unrelated birth there.
 *
 * Ember Animated called the two halves `sentSprites` and `receivedSprites` and
 * paired them at a rendezvous. This does the same, as a barrier in the render
 * pass itself: every region that will animate announces while Glimmer is still
 * rendering, then all of them MEASURE, then ids are MATCHED across regions,
 * then each region RUNs its own timeline — three phases, no frame in between.
 *
 * The receiver is the half that flies. It takes the sender's box as an
 * `initial` it never had and becomes a `kept` sprite carrying the sender as its
 * `counterpart`, which is the same shape counterpart matching already produces
 * inside one region — so every step that understands `kept` works across the
 * boundary with nothing further to teach it. The sender is dropped rather than
 * orphaned: the thing it would animate is already being animated somewhere else.
 *
 * Bounds cross in PAGE space, the only space two regions agree on.
 *
 * The switch turns it off by making the ids region-scoped (`kiln-atlas` rather
 * than `atlas`), which is all "off" means — nothing to match. Watch what you
 * get instead: a fade out here, an unrelated fade in there, and no sense at all
 * that it is the same piece.
 */
export class FarMatch extends Component {
  @tracked matching = true;
  @tracked placement: Record<string, Bay> = {
    atlas: 'kiln',
    ember: 'kiln',
    flux: 'quench',
    halo: 'rack',
  };

  toggle = () => {
    this.matching = !this.matching;
  };

  /** send a piece to the next bay, wrapping — so it can also fly the whole width back */
  advance = (id: string) => {
    const at = bays.findIndex((bay) => bay.id === this.placement[id]);
    this.placement = {
      ...this.placement,
      [id]: bays[(at + 1) % bays.length]!.id,
    };
  };

  piecesIn = (bay: Bay) =>
    pieces.filter((piece) => this.placement[piece.id] === bay);

  /**
   * The identity a region sees.
   *
   * Bare `atlas` in every bay is what lets the barrier pair the two halves.
   * Prefixing it with the bay is the whole of "far matching off": the id that
   * left is not the id that arrived, so there is nothing to pair.
   */
  idFor = (piece: Piece, bay: Bay) =>
    this.matching ? piece.id : `${bay}-${piece.id}`;

  <template>
    <div class="ex">
      <button type="button" class="replay" {{on "click" this.toggle}}>
        Far match ·
        {{if this.matching "on" "off"}}
      </button>

      <div class="foundry">
        {{#each bays as |bay|}}
          {{! one region per bay: three separate scenes, reconciled apart }}
          <Choreo @id={{bay.id}} class="bay" as |c|>
            <span class="bay-head">{{bay.label}}</span>

            <div class="bay-body" {{motion id=bay.id role="bay"}}>
              {{#each (this.piecesIn bay.id) key="id" as |piece|}}
                <button
                  type="button"
                  class="piece"
                  style={{wash piece}}
                  {{motion id=(this.idFor piece bay.id) role="piece"}}
                  {{on "click" (fn this.advance piece.id)}}
                >{{piece.label}}</button>
              {{/each}}
            </div>

            <c.Parallel>
              {{! One rule covers both halves of the job, because to a region
                  they are the same job: every piece that is somewhere new
                  moves there. A neighbour closing a gap has a small delta; a
                  piece that arrived from another bay has the delta between two
                  bays — and only because the barrier gave it the sender's
                  bounds to start from. }}
              <c.Move
                @of={{c.moved "piece"}}
                @spring={{tuneSpring "far" carry "carry"}}
                @size={{false}}
              />
              <c.Hold @of={{c.moved "piece"}} @zIndex={{layer}} />

              {{! With matching ON these two never fire: the sender is let go
                  quietly by its own region (it is not leaving, it is
                  continuing somewhere else) and the receiver is `kept`, not
                  `inserted`. Turn the switch off and they are the whole
                  transition. }}
              <c.Tween
                @of={{c.removed "piece"}}
                @opacity={{0}}
                @duration={{tuneSeconds "far" 0.2 "Step 1 duration"}}
              />
              <c.Tween
                @of={{c.inserted "piece"}}
                @opacity={{array 0 1}}
                @duration={{tuneSeconds "far" 0.26 "Step 2 duration"}}
              />

              {{! and the bay itself grows or shrinks around what it now holds }}
              <c.Move
                @of={{c.moved "bay"}}
                @spring={{tuneSpring "far" settle "settle"}}
              />
            </c.Parallel>
          </Choreo>
        {{/each}}
      </div>
    </div>
  </template>
}

function wash(piece: Piece) {
  return `--wash: ${piece.wash}`;
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('far', carry, 'carry');
tuneSeconds('far', 0.2, 'Step 1 duration');
tuneSeconds('far', 0.26, 'Step 2 duration');
tuneSpring('far', settle, 'settle');
