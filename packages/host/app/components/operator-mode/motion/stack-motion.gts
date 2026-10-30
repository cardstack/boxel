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

import type { PropSource } from '@cardstack/choreo';

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

// How small a card starts as it scales in.
const SCALE_FROM = 0.1;

const scaleInOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [SCALE_FROM, 1] : [1, 1];
const fadeInOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [0, 1] : [1, 1];
// A phone card slides up from below the viewport: its own height.
const slideUpOnTop: PropSource = (sprite, changeset) =>
  isTopCard(sprite, changeset) ? [sprite.final?.page.height ?? 0, 0] : [0, 0];
// A leaving card sinks by its own height as it fades.
const sinkOut: PropSource = (sprite) => [0, sprite.initial?.page.height ?? 0];

// How long a card under an opening phone card stays in view, read by the
// stylesheet (see stack-item.gts): the entrance's own duration.
const ENTER_DURATION_STYLE = htmlSafe(
  `--stack-item-enter-duration: ${DURATION.space}s`,
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
 * - a removed card fades and sinks, easing in over the exit duration;
 * - a card whose box changed (uncovered, covered, or expanded) moves by
 *   transform to its new place. Its width and height animate as layout, not
 *   by scale, so its text is never scaled (§1.5); the frame reflows under
 *   the card's content, the way a width transition does.
 *
 * Under reduced motion the region's MotionConfig ('user') lands every move
 * at once and keeps the fades (§1.5).
 */
export default class StackMotion extends Component<Signature> {
  private enabled = motionEnabled('boxel-stack-motion');

  <template>
    {{#if this.enabled}}
      <Choreo
        @maxFrameStep={{MAX_FRAME_STEP}}
        style={{ENTER_DURATION_STYLE}}
        ...attributes
        as |c|
      >
        {{yield}}
        <c.Parallel>
          {{#if @phone}}
            <c.Tween
              @of={{c.inserted STACK_ITEM_ROLE}}
              @y={{slideUpOnTop}}
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
            @of={{c.removed STACK_ITEM_ROLE}}
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
