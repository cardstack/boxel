import { array } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { Choreo } from '@cardstack/choreo';

import {
  DURATION,
  EASE,
  EASE_IN,
  MAX_FRAME_STEP,
  motionEnabled,
} from '../../ai-assistant/motion/tokens';

import type { PropSource, Query } from '@cardstack/choreo';

// A stack's motion, as one Choreo region around its cards (ADR 007 §1.2:
// one engine reacts to rendered changes; nothing here is started by a
// caller). Opening, closing and reordering cards are the state service's
// plain changes to the stack; the region watches the render pass they land
// in and plays this score over what was inserted, removed and moved (§1.1:
// state never waits on it). In tests the region is not rendered and the same
// markup stands in a plain box, so the DOM is the same either way.
//
// Participants (declared where the markup lives, in stack-item.gts):
//   role='stack-item'  a card's root, with an id that survives the item's
//                      clones, so a card that takes its saved id or moves
//                      stacks is kept, not re-entered.

type Changeset = Parameters<Extract<PropSource, Function>>[1];
type Sprite = Parameters<Extract<PropSource, Function>>[0];

export const STACK_ITEM_ROLE = 'stack-item';

/**
 * A card leaving the stack: removed, and claimed by no card that carries its
 * identity on. The old element of a clone (a card replaced in place by its
 * copy) is the claimed half of that pair, and leaves with no motion of its
 * own, since its replacement stands where it stood.
 */
const DEPARTED: Query = { role: STACK_ITEM_ROLE, type: 'departed' };

/**
 * The card on top of its stack: the last of the cards standing after the
 * pass, in document order. Cards under it are inserted alongside it only as
 * a stack is restored whole, and those are covered, so only the top card
 * plays the entrance.
 */
const isTopCard = (sprite: Sprite, changeset: Changeset) =>
  !changeset
    .sprites([
      { role: STACK_ITEM_ROLE, type: 'kept' },
      { role: STACK_ITEM_ROLE, type: 'inserted' },
    ])
    .some(
      (other) =>
        other !== sprite &&
        Boolean(
          sprite.element.compareDocumentPosition(other.element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    );

/**
 * Motion is reduced, by the policy the region follows (glimmer-motion's
 * MotionConfig 'user', the host's default). Read as each pass compiles. A
 * reduced run lands every positional value at its end as its step opens, so
 * a value that travels has to stand still here for the card to fade where
 * it is.
 */
const reducesMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

// How small a card starts as it scales in.
const SCALE_FROM = 0.1;

const scaleInOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [SCALE_FROM, 1] : [1, 1];
const fadeInOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [0, 1] : [1, 1];
// A phone card slides up from below the viewport: its own height.
const slideUpOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [sprite.final?.page.height ?? 0, 0] : [0, 0];
// Under reduced motion the slide lands at once, so a phone card fades in
// where it stands instead.
const fadeInOnTopWhenReduced: PropSource = (sprite, changeset) =>
  reducesMotion() ? fadeInOnTop(sprite, changeset) : [1, 1];
// A leaving card sinks by its own height as it fades; under reduced motion
// it fades where it stood.
const sinkOut: PropSource = (sprite) =>
  reducesMotion() ? [0, 0] : [0, sprite.initial?.page.height ?? 0];

// How long a phone card stays in view under a card opening over it, read by
// the stylesheet as a transition delay (see stack-item.gts). The slide runs
// on the region's clock, which `@maxFrameStep` slows behind long frames,
// and the delay runs on the wall clock, so it outlasts the slide by
// SLOW_FRAME_ALLOWANCE. Holding the covered card a little longer costs
// nothing to see: the phone card on top paints its own background.
const SLOW_FRAME_ALLOWANCE = 0.5;
const COVERED_CARD_STYLE = htmlSafe(
  `--stack-item-covered-delay: ${DURATION.space + SLOW_FRAME_ALLOWANCE}s`,
);

interface Signature {
  Element: HTMLDivElement;
  Args: {
    /** a phone-width viewport: cards are full width and slide over each other */
    phone?: boolean;
  };
  Blocks: { default: [] };
}

/**
 * A card opening into a stack is a card-sized change of place (§1.5,
 * 300–500 ms), and the cards under it move on the same clock, so the stack
 * reads as one change.
 *
 * - the inserted top card scales in and fades in, easing out; on a phone it
 *   slides up from below the viewport instead;
 * - a departing card fades and sinks, easing in over the exit duration;
 * - a card whose box changed (uncovered, covered, or expanded) moves by
 *   transform to its new place. Its width and height animate as layout, not
 *   by scale, so its text is never scaled (§1.5); the frame reflows under
 *   the card's content, the way a width transition does.
 *
 * Under reduced motion the region's MotionConfig ('user') lands every move
 * at once, and a card fades in or out where it stands, on a phone as on a
 * wide screen (§1.5).
 */
export default class StackMotion extends Component<Signature> {
  private enabled = motionEnabled('boxel-stack-motion');

  <template>
    {{#if this.enabled}}
      <Choreo
        @maxFrameStep={{MAX_FRAME_STEP}}
        style={{COVERED_CARD_STYLE}}
        ...attributes
        as |c|
      >
        {{yield}}
        <c.Parallel>
          {{#if @phone}}
            <c.Tween
              @of={{c.inserted STACK_ITEM_ROLE}}
              @y={{slideUpOnTop}}
              @opacity={{fadeInOnTopWhenReduced}}
              @duration={{DURATION.space}}
              @ease={{EASE}}
            />
          {{else}}
            <c.Tween
              @of={{c.inserted STACK_ITEM_ROLE}}
              @scale={{scaleInOnTop}}
              @opacity={{fadeInOnTop}}
              @duration={{DURATION.space}}
              @ease={{EASE}}
            />
          {{/if}}
          <c.Tween
            @of={{DEPARTED}}
            @opacity={{array 1 0}}
            @y={{sinkOut}}
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
          <c.Move
            @of={{c.moved STACK_ITEM_ROLE}}
            @duration={{DURATION.space}}
            @ease={{EASE}}
          />
        </c.Parallel>
      </Choreo>
    {{else}}
      <div ...attributes>{{yield}}</div>
    {{/if}}
  </template>
}
