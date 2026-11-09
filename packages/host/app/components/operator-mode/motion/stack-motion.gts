import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { Choreo } from '@cardstack/choreo';

import {
  DURATION,
  EASE,
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

// Every positional value here is ONE transform string, never separate x, y
// or scale values and never a size: a whole transform keyframe pair rides
// the platform's own animation (WAAPI, off the main thread), where separate
// values and sizes are written by script every frame and a size re-lays out
// the card's content each time. That is what keeps the stack smooth while
// the card under the motion is still rendering.

/** the translation a card is painted with right now, mid-flight or at rest */
const paintedTranslation = (sprite: Sprite) => {
  const matrix = new DOMMatrixReadOnly(
    getComputedStyle(sprite.element).transform,
  );
  return { x: matrix.m41, y: matrix.m42 };
};

const STILL = ['none', 'none'];

// An opened card lifts into place from just below it as it fades in. Text
// and card content should not scale in motion (§1.5), so the entrance moves
// it, a short distance, and the fade carries the arrival.
const LIFT = 24;
const liftInOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) && !reducesMotion()
    ? [`translate(0px, ${LIFT}px)`, 'none']
    : STILL;
const fadeInOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [0, 1] : [1, 1];
// A phone card slides up from below the viewport: its own height. Under
// reduced motion it fades in where it stands instead.
const slideUpOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) && !reducesMotion()
    ? [`translate(0px, ${sprite.final?.page.height ?? 0}px)`, 'none']
    : STILL;
const fadeInOnTopWhenReduced: PropSource = (sprite, changeset) =>
  reducesMotion() ? fadeInOnTop(sprite, changeset) : [1, 1];

// A leaving card drops a little below where it is painted as it fades
// (a card closed mid-glide drops from where it is, not to a fixed place);
// under reduced motion it fades where it stood.
const DROP = 18;
const dropOut: PropSource = (sprite) => {
  const { x, y } = paintedTranslation(sprite);
  const from = `translate(${x}px, ${y}px)`;
  return reducesMotion()
    ? [from, from]
    : [from, `translate(${x}px, ${y + DROP}px)`];
};

/**
 * A card whose place changed (covered, uncovered, expanded) glides from the
 * center it was painted at to its new one, by transform alone. Its size
 * lands at once: the card is laid out once at its new width, and only
 * travels, so its content never re-lays out frame by frame. Center to
 * center, because the stack centers its cards: a card that narrows stays
 * under its own middle. Measured against the painted translation, so a
 * card caught mid-flight (or measured with its transform still on) carries
 * on from where it is seen.
 *
 * Under reduced motion it lands at once. The region's reduced motion lands
 * only the separate positional values (x, y, scale, width, height); a whole
 * transform string is not one of them, so this value has to stand still
 * itself, as the entrance and the exit do.
 */
const reflow: PropSource = (sprite, changeset) => {
  const from = sprite.initial?.page;
  const to = sprite.final?.page;
  if (!from || !to || reducesMotion()) {
    return STILL;
  }
  const painted = paintedTranslation(sprite);
  const zoom = changeset.measureZoom || 1;
  const x =
    painted.x + (from.x + from.width / 2 - (to.x + to.width / 2)) / zoom;
  const y = painted.y + (from.y - to.y) / zoom;
  return Math.abs(x) < 0.5 && Math.abs(y) < 0.5
    ? STILL
    : [`translate(${x}px, ${y}px)`, 'none'];
};

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
 * - the inserted top card lifts into place and fades in, easing out; on a
 *   phone it slides up from below the viewport instead;
 * - a departing card fades and drops a little, over the exit duration;
 * - a card whose box changed (uncovered, covered, or expanded) takes its
 *   new size at once and glides by transform from the center it was painted
 *   at to its new one, so its content is laid out once and only travels.
 *   A fade the card was still playing (an entrance cut short) is carried on
 *   by the region itself, so this step names only the transform.
 *
 * Under reduced motion every move lands at once, and a card fades in or out
 * where it stands, on a phone as on a wide screen (§1.5). Each transform
 * value here checks for it itself: the region's MotionConfig ('user') lands
 * separate positional values, never a whole transform string.
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
              @transform={{slideUpOnTop}}
              @opacity={{fadeInOnTopWhenReduced}}
              @duration={{DURATION.space}}
              @ease={{EASE}}
            />
          {{else}}
            <c.Tween
              @of={{c.inserted STACK_ITEM_ROLE}}
              @transform={{liftInOnTop}}
              @opacity={{fadeInOnTop}}
              @duration={{DURATION.space}}
              @ease={{EASE}}
            />
          {{/if}}
          <c.Tween
            @of={{DEPARTED}}
            @opacity={{0}}
            @transform={{dropOut}}
            @duration={{DURATION.exit}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.kept STACK_ITEM_ROLE}}
            @transform={{reflow}}
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
