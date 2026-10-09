import XIcon from '@cardstack/boxel-icons/x';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion } from '../lib/tuning';
import LightboxNotes from '../notes/lightbox';

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
      <div class='ex' {{this.register}}>
        <div class='shots'>
          {{#each photos as |photo|}}
            <button
              type='button'
              class={{if (isOpen photo this.lit) 'shot is-open' 'shot'}}
              {{on 'click' (fn this.choose photo)}}
            >
              <span
                class='shot-card'
                {{motion
                  layoutId=(cardId photo.id)
                  layoutCrossfade=false
                  style=(photoStyle photo)
                  transition=(tuneMotion 'lightbox' spring 'spring')
                }}
              >
                <span
                  class='shot-name'
                  {{motion
                    layoutId=(nameId photo.id)
                    layoutCrossfade=false
                    transition=(tuneMotion 'lightbox' spring 'spring')
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
          <div class={{if this.open 'overlay' 'overlay is-closing'}}>
            <button
              type='button'
              class='backdrop'
              {{motion
                presence=h
                initial=fade
                animate=fadeOn
                exit=fadeOut
                transition=(tuneMotion 'lightbox' fadeTween 'fadeTween')
              }}
              {{on 'click' this.close}}
            ><span class='sr'>Close</span></button>
            <article
              class='lightbox'
              {{motion
                presence=h
                layoutId=(cardId photo.id)
                layoutCrossfade=false
                style=(photoStyle photo)
                transition=(tuneMotion 'lightbox' spring 'spring')
              }}
            >
              <button
                type='button'
                class='lightbox-close'
                aria-label='Close'
                {{motion
                  presence=h
                  initial=detailsIn
                  animate=detailsOn
                  exit=detailsOut
                  transition=(tuneMotion 'lightbox' detailsTween 'detailsTween')
                }}
                {{on 'click' this.close}}
              ><XIcon /></button>
              <div class='lightbox-body'>
                <b
                  {{motion
                    presence=h
                    layoutId=(nameId photo.id)
                    layoutCrossfade=false
                    transition=(tuneMotion 'lightbox' spring 'spring')
                  }}
                >{{photo.label}}</b>
                <div
                  class='lightbox-details'
                  {{motion
                    presence=h
                    initial=detailsIn
                    animate=detailsOn
                    exit=detailsOut
                    transition=(tuneMotion
                      'lightbox' detailsTween 'detailsTween'
                    )
                  }}
                >
                  <dl class='facts'>
                    <div class='fact'>
                      <dt>Heat</dt>
                      <dd>{{photo.heat}}</dd>
                    </div>
                    <div class='fact'>
                      <dt>Stock</dt>
                      <dd>{{photo.stock}}</dd>
                    </div>
                    <div class='fact'>
                      <dt>Take</dt>
                      <dd>{{photo.take}}</dd>
                    </div>
                  </dl>
                  <p class='lightbox-notes'>{{photo.notes}}</p>
                </div>
              </div>
            </article>
          </div>
        </Presence>
      </div>
    </LayoutGroup>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
         reads as a layout bug rather than as a stage, and the ones sized
         `min(Npx, 100%)` hit the frame exactly when the card is narrow.
         The block padding was missing for a long time and it showed on any stage
         tall enough to fill the platter: the content sat flush against the top and
         bottom of the recess while keeping its 16px at the sides, which reads as
         content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .shots {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        width: min(86%, 280px);
      }

      .shot {
        position: relative;
        aspect-ratio: 1;
        border: 0;
        padding: 0;
        background: transparent;
        border-radius: 18px;
      }

      .shot-card {
        position: absolute;
        inset: 0;
        /* radius is declared on the element — see photoStyle() in
         stages/lightbox.gts, so it can be scale-corrected */
        box-shadow: 0 12px 28px
          rgba(var(--shadow-rgb), calc(0.35 * var(--shadow-a)));
      }

      .shot.is-open {
        pointer-events: none;
        /* while it is the shared element, the tile rides above the scrim — otherwise
         the backdrop paints over it on the way back down */
        z-index: 3;
      }

      .shot-name {
        position: absolute;
        left: 12px;
        bottom: 10px;
        width: fit-content;
        color: #fff;
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1.2;
        white-space: nowrap;
        transform-origin: left bottom;
      }

      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }

      /* closing is instant; the exit ANIMATION is not. Presence keeps this whole
       tree mounted until its slowest exiting child settles — the layoutId
       spring on .lightbox can run well past its own visualDuration — and until
       then .backdrop, full-stage and still `cursor: pointer`, would keep eating
       clicks on the grid underneath it even though it is already invisible. */

      .overlay.is-closing {
        pointer-events: none;
      }

      .backdrop {
        position: absolute;
        inset: 0;
        border: 0;
        padding: 0;
        cursor: pointer;
        background:
          radial-gradient(
            120% 90% at 50% 42%,
            rgba(255, 106, 58, 0.16),
            transparent 58%
          ),
          radial-gradient(
            100% 100% at 50% 50%,
            rgba(var(--bg-rgb), 0.5),
            rgba(var(--bg-rgb), 0.86)
          );
        backdrop-filter: blur(10px) saturate(0.8);
      }

      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }

      .lightbox {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        /* Bounded on BOTH axes, against the stage rather than the page. `.ex` is a
         size container, so 64cqh is the widest a 4:5 card can be and still leave
         20% of the stage's height around it — without that third term the card is
         only ever bounded by width, and on a short stage it grows straight through
         the top and bottom of the frame it is supposed to open inside. */
        width: min(74cqw, 268px, 56cqh);
        aspect-ratio: 4 / 5;
        max-height: 72cqh;
        overflow: hidden;
        /* radius is declared on the element — see photoStyle() in
         stages/lightbox.gts, so it can be scale-corrected */
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.16) inset,
          0 0 0 1px var(--lightbox-ring, rgba(0, 0, 0, 0.5)),
          0 30px 80px rgba(0, 0, 0, 0.62);
      }

      .lightbox-close {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 2;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 999px;
        background: rgba(8, 7, 6, 0.42);
        backdrop-filter: blur(6px);
        color: rgba(255, 255, 255, 0.86);
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
        transition:
          background-color 0.16s var(--ease),
          border-color 0.16s var(--ease);
      }

      @media (hover: hover) {
        .lightbox-close:hover {
          background: rgba(8, 7, 6, 0.72);
          border-color: rgba(255, 255, 255, 0.42);
        }
      }

      .lightbox-body {
        /* Frosted glass rather than a black gradient smeared over the wash: the
         panel takes its colour FROM the card behind it, so every card gets its own
         tint instead of the same grey fade. It floats inset with its own radius,
         rather than running edge to edge into the card's corners. */
        margin: 10px;
        padding: 14px 15px 15px;
        overflow: hidden;
        border-radius: 15px;
        background: rgba(12, 9, 8, 0.38);
        /* Set here, not inherited. This panel is dark glass over a photograph in
         BOTH themes — that is the point of taking its colour from the card behind
         it — so its text is light in both. Inheriting `--ink` put a near-black
         title on a dark amber panel the moment light mode existed; the facts and
         the note never had the bug because they name their own white. */
        color: #fff;
        backdrop-filter: blur(26px) saturate(1.6);
        -webkit-backdrop-filter: blur(26px) saturate(1.6);
        border: 1px solid rgba(255, 255, 255, 0.18);
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.14) inset,
          0 14px 34px rgba(0, 0, 0, 0.34);
      }

      .lightbox-body b {
        /* Shrink-to-fit, exactly like the tile's name. Both boxes then hug the same
         string and differ only by font-size, so they are geometrically SIMILAR —
         and a layout animation between similar boxes scales uniformly. A block
         here made the lightbox title full-width, so the shared element scaled x
         and y by different amounts and the glyphs smeared. */
        display: inline-block;
        width: fit-content;
        font-family: var(--font-display);
        font-size: 25px;
        letter-spacing: -0.03em;
        line-height: 1.2;
        white-space: nowrap;
        transform-origin: left bottom;
      }

      .lightbox-details {
        margin-top: 12px;
      }

      .facts {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 0;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.14);
      }

      .fact {
        min-width: 0;
      }

      .fact dt {
        margin-bottom: 2px;
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
      }

      .fact dd {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        color: #fff;
      }

      .lightbox-notes {
        margin: 12px 0 0;
        color: rgba(255, 255, 255, 0.74);
        font-size: 12px;
        line-height: 1.45;
      }

      @container (max-width: 420px) {
        .shots {
          width: min(92%, 100%);
          max-width: 100%;
        }

        .lightbox {
          width: min(88%, 100%);
        }

        .lightbox-body {
          margin: 8px;
          padding: 10px 12px 12px;
        }

        .lightbox-body b {
          font-size: 20px;
        }

        .lightbox-notes {
          display: none;
        }
      }

      @container (max-width: 280px) {
        .shots {
          gap: 6px;
        }
      }

      .choreo-site:not([data-theme='light']) .backdrop {
        background:
          radial-gradient(
            120% 90% at 50% 42%,
            rgba(255, 106, 58, 0.16),
            transparent 58%
          ),
          radial-gradient(
            100% 100% at 50% 50%,
            rgba(28, 24, 20, 0.42),
            rgba(20, 17, 14, 0.78)
          );
      }

      .lightbox-close :deep(svg) {
        width: 18px;
        height: 18px;
      }
    </style>
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

export class LightboxDemo extends GalleryDemo {
  static stage = Lightbox;
  static notes = LightboxNotes;
}
