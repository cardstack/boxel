import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';
import { tuneMotion } from 'test-app/lib/demo-tuning';

const photos = [
  {
    heat: '1280°',
    id: 'atlas',
    label: 'Atlas',
    notes: 'Held the last props. Clean handoff.',
    stock: 'Kiln floor',
    take: '04',
    wash: 'linear-gradient(160deg, #ff7a45 0%, #c42712 42%, #2a0c08 100%)',
  },
  {
    heat: '920°',
    id: 'ember',
    label: 'Ember',
    notes: 'Orange hold, then snap.',
    stock: 'Night shift',
    take: '11',
    wash: 'linear-gradient(145deg, #ffb36a 0%, #ff3b1f 48%, #4a1208 100%)',
  },
  {
    heat: '640°',
    id: 'flux',
    label: 'Flux',
    notes: 'Steel wash. No bounce.',
    stock: 'Cooling rack',
    take: '02',
    wash: 'linear-gradient(165deg, #c5cdd0 0%, #5c6568 40%, #1a1613 100%)',
  },
  {
    heat: '410°',
    id: 'halo',
    label: 'Halo',
    notes: 'Clear after the pour.',
    stock: 'Foundry glass',
    take: '08',
    wash: 'linear-gradient(150deg, #fff4e8 0%, #e4a35a 45%, #5a3214 100%)',
  },
];

const keyOf = (item: { id: string }) => item.id;
const fade = { opacity: 0 };
const fadeOn = { opacity: 1 };
/**
 * The scrim trails the card rather than racing it.
 *
 * At 0.28s against the card's 0.5s spring the room went dark before the thing
 * you tapped had finished growing, so the darkening read as the event and the
 * card as an afterthought. Slower than the spring, the order reverses: the
 * card is what moves, and the room settles around it.
 *
 * Leaving is the other way round — a scrim that fades out slowly is just a
 * grey veil sitting over a grid you have already come back to — so exit
 * carries its own quicker transition.
 */
const fadeTween = { duration: 0.62, ease: [0.22, 1, 0.36, 1] } as const;
const fadeOut = {
  opacity: 0,
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
} as const;
const detailsIn = { opacity: 0 };
const detailsOn = { opacity: 1 };
const detailsOut = { opacity: 0 };
const detailsTween = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;
const spring = { bounce: 0.12, type: 'spring', visualDuration: 0.5 } as const;

interface SeekableLightboxElement extends HTMLElement {
  seekDemo?: (time: number) => PromiseLike<void> | void;
}

type Photo = (typeof photos)[number];

export class Lightbox extends Component {
  @tracked lit: Photo | null = null;
  @tracked open: Photo | null = null;

  get overlay() {
    return this.open ? [this.open] : [];
  }

  choose = (photo: Photo) => {
    this.lit = photo;
    this.open = photo;
  };

  close = () => {
    this.open = null;
  };

  cleared = () => {
    this.lit = null;
  };

  private root?: HTMLElement;

  register = modifier((el: HTMLElement) => {
    this.root = el;
    (el as SeekableLightboxElement).seekDemo = this.seekDemo;
    return () => {
      delete (el as SeekableLightboxElement).seekDemo;
      this.root = undefined;
    };
  });

  /**
   * Optional capture handle: stand this demo's own animations at a
   * LOCAL-time still. Nothing else — which photo is open, and when, is
   * the composition's decision, sent through the same buttons a person
   * clicks. Ordinary gallery interaction is unchanged.
   */
  seekDemo = (time: number) => {
    for (const animation of this.root?.getAnimations({ subtree: true }) ?? []) {
      animation.pause();
      const end = Number(animation.effect?.getComputedTiming().endTime ?? 0);
      animation.currentTime = Math.min(Math.max(0, time) * 1000, end);
    }
  };

  <template>
    {{! The shared card has one painted owner. Crossfading both copies makes
        offset silhouettes and duplicate labels visible in a projected room.
        Keep the layout morph, but hand visibility directly to its lead. }}
    <LayoutGroup>
      <div class="ex" {{this.register}}>
        <div class="shots">
          {{#each photos as |photo|}}
            <button
              type="button"
              class={{if (isOpen photo this.lit) "shot is-open" "shot"}}
              {{on "click" (fn this.choose photo)}}
            >
              <span
                class="shot-card"
                {{motion
                  layoutId=(cardId photo.id)
                  layoutCrossfade=false
                  style=(photoStyle photo)
                  transition=(tuneMotion "lightbox" spring "spring")
                }}
              >
                <span
                  class="shot-name"
                  {{motion
                    layoutId=(nameId photo.id)
                    layoutCrossfade=false
                    transition=(tuneMotion "lightbox" spring "spring")
                  }}
                >{{photo.label}}</span>
              </span>
            </button>
          {{/each}}
        </div>
        <Presence
          @items={{this.overlay}}
          @key={{keyOf}}
          @onExitComplete={{this.cleared}}
          as |photo h|
        >
          {{! `is-closing` the instant `close()` runs — not gated on the exit
              animation finishing. `.backdrop` covers the whole stage, and
              Presence keeps this whole tree mounted for as long as its
              SLOWEST exiting child takes to settle: the layoutId spring on
              `.lightbox` itself, whose numeric settle can run well past its
              own visualDuration. Left alone, the invisible backdrop keeps
              eating clicks on the grid underneath for that entire stretch. }}
          <div class={{if this.open "overlay" "overlay is-closing"}}>
            <button
              type="button"
              class="backdrop"
              {{motion
                presence=h
                initial=fade
                animate=fadeOn
                exit=fadeOut
                transition=(tuneMotion "lightbox" fadeTween "fadeTween")
              }}
              {{on "click" this.close}}
            ><span class="sr">Close</span></button>
            <article
              class="lightbox"
              {{motion
                presence=h
                layoutId=(cardId photo.id)
                layoutCrossfade=false
                style=(photoStyle photo)
                transition=(tuneMotion "lightbox" spring "spring")
              }}
            >
              <button
                type="button"
                class="lightbox-close"
                aria-label="Close"
                {{motion
                  presence=h
                  initial=detailsIn
                  animate=detailsOn
                  exit=detailsOut
                  transition=(tuneMotion "lightbox" detailsTween "detailsTween")
                }}
                {{on "click" this.close}}
              >&times;</button>
              <div class="lightbox-body">
                <b
                  {{motion
                    presence=h
                    layoutId=(nameId photo.id)
                    layoutCrossfade=false
                    transition=(tuneMotion "lightbox" spring "spring")
                  }}
                >{{photo.label}}</b>
                <div
                  class="lightbox-details"
                  {{motion
                    presence=h
                    initial=detailsIn
                    animate=detailsOn
                    exit=detailsOut
                    transition=(tuneMotion
                      "lightbox" detailsTween "detailsTween"
                    )
                  }}
                >
                  <dl class="facts">
                    <div class="fact">
                      <dt>Heat</dt>
                      <dd>{{photo.heat}}</dd>
                    </div>
                    <div class="fact">
                      <dt>Stock</dt>
                      <dd>{{photo.stock}}</dd>
                    </div>
                    <div class="fact">
                      <dt>Take</dt>
                      <dd>{{photo.take}}</dd>
                    </div>
                  </dl>
                  <p class="lightbox-notes">{{photo.notes}}</p>
                </div>
              </div>
            </article>
          </div>
        </Presence>
      </div>
    </LayoutGroup>
  </template>
}

function cardId(id: string) {
  return `${id}-card`;
}

function nameId(id: string) {
  return `${id}-name`;
}

function isOpen(photo: Photo, open: Photo | null) {
  return photo === open;
}

/**
 * Declare what you want tweened. Both halves of the shared element carry their
 * own radius, so the engine can correct it against the scale it is applying —
 * a thumbnail growing into a hero is scaled hard on both axes, and a radius
 * left in the stylesheet comes out oval on the way.
 */
function photoStyle(photo: Photo) {
  return { background: photo.wash, borderRadius: '18px' };
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('lightbox', spring, 'spring');
tuneMotion('lightbox', fadeTween, 'fadeTween');
tuneMotion('lightbox', detailsTween, 'detailsTween');
