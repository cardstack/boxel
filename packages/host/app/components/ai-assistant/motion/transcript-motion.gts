import { array } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Choreo } from '@cardstack/choreo';
import { modifier } from 'ember-modifier';

import { not } from '@cardstack/boxel-ui/helpers';

import {
  DURATION,
  EASE,
  EASE_FOLLOW,
  EASE_IN,
  RISE,
  SETTLE_AFTER_MS,
  MAX_FRAME_STEP,
  motionEnabled,
} from './tokens';

import type { PropSource } from '@cardstack/choreo';

// The transcript's motion, as two kinds of Choreo region (ADR 007 §1.2: one
// engine reacts to rendered changes; nothing here is started by a caller).
// Read motion/README.md for the participants each region expects and the
// ADR rule each step answers to.

type Changeset = Parameters<Extract<PropSource, Function>>[1];
type Sprite = Parameters<Extract<PropSource, Function>>[0];

// The conversation's messages, in the pass, that have a place to go to.
const STACKED = [
  { role: 'message', type: 'kept' },
  { role: 'message-live', type: 'kept' },
  { role: 'message', type: 'inserted' },
  { role: 'message-live', type: 'inserted' },
] as const;

interface Start {
  /** the translateY the message starts at, from its new place */
  y: number;
  /** an arrival carried by the block above it, rather than rising alone */
  travelling: boolean;
}

const startsByPass = new WeakMap<Changeset, Map<Sprite, Start>>();

/**
 * Where each message starts in this pass.
 *
 * A kept message starts where it was painted and takes its new size at
 * once (translate only, so text never scales). A message that grew
 * therefore draws its new bottom at once, and the message below it,
 * starting where it was painted, would sit under that bottom until both
 * landed. So no message starts above the block above it: on one clock the
 * two keep their gap in every frame (ADR 013 §1.10, §1.20). A message that
 * grew pushes the ones below down at once, as layout does, and a message
 * that shrank lets them glide up.
 *
 * When the follow scrolled, the end is where the reader looks, and it
 * stays put: what the follow's scroll moved lands with it, and the newest
 * message never starts below the view's edge. What changed above the end
 * still moves (a turn folding), relative to the end. Played as a glide,
 * the follow kept the newest lines out of view for a move's length on
 * every update, and a cap opening under the transcript moved it a pixel a
 * frame. Only the scroll lands: in a transcript too short to scroll, a
 * message that moved up because one above it shrank still glides.
 *
 * Not following, an arrival is fixed to the block above the same way: it
 * starts where that block's move puts it and travels on its clock; with
 * nothing above it moving, it rises its usual few px. Following, it fades
 * in where it lands.
 */
/** each scroller's position after the last pass or scroll this layer saw */
const scrollSeen = new WeakMap<HTMLElement, number>();

/** How far the scroller moved since the last pass, and note where it is. */
function scrolledSince(scroller: HTMLElement): number {
  let now = scroller.scrollTop;
  let before = scrollSeen.get(scroller);
  if (before === undefined) {
    // the reader's own scrolls between passes are not this pass's
    scroller.addEventListener(
      'scroll',
      () => scrollSeen.set(scroller, scroller.scrollTop),
      { passive: true },
    );
    before = now;
  }
  scrollSeen.set(scroller, now);
  return now - before;
}

function startsOf(changeset: Changeset): Map<Sprite, Start> {
  let known = startsByPass.get(changeset);
  if (known) {
    return known;
  }
  known = new Map();
  let stack = changeset
    .sprites([...STACKED])
    .filter((s) => s.final)
    .sort((a, b) => a.final!.page.y - b.final!.page.y);
  let painted = (s: Sprite) => -(s.delta?.y ?? 0);
  let scroller = stack[0]?.element.closest<HTMLElement>('[data-following]');
  let scrolled = scroller ? scrolledSince(scroller) : 0;
  let following = scroller?.getAttribute('data-following') === 'true';
  if (following && scrolled !== 0) {
    // the end holds: what the bottom kept message moved on screen, as far
    // as the scroll moved it, lands; from the bottom up no message starts
    // below the one under it
    let kept = stack.filter((s) => s.type === 'kept');
    let bottom = kept.length ? painted(kept[kept.length - 1]!) : 0;
    let base =
      Math.sign(bottom) === Math.sign(scrolled)
        ? Math.sign(bottom) * Math.min(Math.abs(bottom), Math.abs(scrolled))
        : 0;
    let below: number | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      let s = stack[i]!;
      let start: Start;
      if (s.type === 'inserted') {
        // it fades in where it lands: a rise would start it below the edge,
        // and a pass during the rise would take the rise for the follow's
        start = { y: 0, travelling: false };
        below = below === undefined ? 0 : Math.min(below, 0);
      } else {
        let own = painted(s) - base;
        let y = below === undefined ? own : Math.min(own, below);
        start = { y, travelling: false };
        below = y;
      }
      known.set(s, start);
    }
  } else {
    let above: number | undefined;
    for (let s of stack) {
      let start: Start;
      if (s.type === 'inserted') {
        start = above
          ? { y: above, travelling: true }
          : { y: RISE, travelling: false };
      } else {
        start = {
          y: above === undefined ? painted(s) : Math.max(painted(s), above),
          travelling: false,
        };
      }
      known.set(s, start);
      above = start.y;
    }
  }
  startsByPass.set(changeset, known);
  return known;
}

const startOf = (sprite: Sprite, changeset: Changeset): Start =>
  startsOf(changeset).get(sprite) ??
  (sprite.type === 'inserted'
    ? { y: RISE, travelling: false }
    : { y: -(sprite.delta?.y ?? 0), travelling: false });

const fromStart: PropSource = (sprite, changeset) => [
  startOf(sprite, changeset).y,
  0,
];

// Travelling with the block above, an arrival comes up from below the
// viewport's edge with everything else, so it needs no fade, and a fade
// would not survive the next pass: a reply's second render recompiles the
// run mid-arrival, and the new score moves the message without fading it,
// so its opacity snapped to full over the answer above. Otherwise it fades in.
const fadeUnlessTravelling: PropSource = (sprite, changeset) =>
  startOf(sprite, changeset).travelling ? [1, 1] : [0, 1];

interface Signature {
  Element: HTMLDivElement;
  Args: {
    /** the room's history is in */
    ready?: boolean;
    /** the room shown: another room's history is a load, not a change */
    roomId?: string;
  };
  Blocks: { default: [] };
}

/**
 * The conversation: its messages are the participants (`role='message'`,
 * declared on each message's section). A message that lands rises and
 * fades in; a message that leaves (a turn folding away) fades; every message
 * whose box changed moves to its new place, translate only: a message that
 * grew or shrank takes its new size at once, so text is never scaled
 * (§1.5). No crop: Choreo leaves a finished crop's clip-path (inset(0px))
 * on the element, which cuts every ring and inset that hangs into the
 * gutter (framed rows, tables, cards). A message still streaming is declared
 * `role='message-live'`: it moves with the rest (translate only), and its
 * growth token by token lands instantly, since high-frequency change gets
 * no motion of its own (§1.5).
 *
 * Only what can be seen is wired (`@inView`, ADR 013 §1.18): messages in
 * the transcript's view or within a view of it. The rest are left to
 * layout. The region sits out (`@idle`) until the room's history is in and
 * has settled, so the load lands as layout puts it (§1.19). It sits out
 * again while a history loads and whenever another room is shown.
 */
export class TranscriptMotion extends Component<Signature> {
  private enabled = motionEnabled();
  // the room whose history has been in for a moment; awake only for it
  @tracked private settledRoom: string | undefined | null = null;

  private get awake() {
    return Boolean(this.args.ready) && this.settledRoom === this.args.roomId;
  }

  // wakes the region once the history has been in for a moment: the
  // first render, and the cards and images it loads, are not changes
  private wakeWhenReady = modifier(
    (
      _element: HTMLElement,
      [ready, roomId]: [boolean | undefined, string | undefined],
    ) => {
      let alive = () => !this.isDestroying && !this.isDestroyed;
      if (!ready) {
        // a history that loads again settles again
        if (this.settledRoom !== null) {
          queueMicrotask(() => alive() && (this.settledRoom = null));
        }
        return;
      }
      if (this.settledRoom === roomId) {
        return;
      }
      let timer = setTimeout(() => {
        if (alive()) {
          this.settledRoom = roomId;
        }
      }, SETTLE_AFTER_MS);
      return () => clearTimeout(timer);
    },
  );

  <template>
    {{#if this.enabled}}
      <Choreo
        @id='assistant-transcript'
        class='transcript-region'
        @idle={{not this.awake}}
        @inView={{true}}
        @maxFrameStep={{MAX_FRAME_STEP}}
        {{this.wakeWhenReady @ready @roomId}}
        ...attributes
        as |c|
      >
        {{yield}}
        {{#if this.awake}}
          <c.Parallel>
            {{! every message on one clock, from where startsOf puts it:
                where it was painted, but never above the block above it.
                Translate only: a message that grew or shrank takes its new
                size at once, so text never scales. The streaming message
                travels with the rest, but its growth lands as it renders }}
            <c.Tween
              @of={{c.kept 'message'}}
              @y={{fromStart}}
              @duration={{DURATION.move}}
              @ease={{EASE_FOLLOW}}
            />
            <c.Tween
              @of={{c.kept 'message-live'}}
              @y={{fromStart}}
              @duration={{DURATION.move}}
              @ease={{EASE_FOLLOW}}
            />
            <c.Tween
              @of={{c.inserted 'message-live'}}
              @opacity={{fadeUnlessTravelling}}
              @y={{fromStart}}
              @duration={{DURATION.move}}
              @ease={{EASE_FOLLOW}}
            />
            <c.Tween
              @of={{c.inserted 'message'}}
              @opacity={{fadeUnlessTravelling}}
              @y={{fromStart}}
              @duration={{DURATION.move}}
              @ease={{EASE_FOLLOW}}
            />
            <c.Tween
              @of={{c.removed 'message'}}
              @opacity={{array 1 0}}
              @duration={{DURATION.exit}}
              @ease={{EASE_IN}}
            />
          </c.Parallel>
        {{/if}}
      </Choreo>
    {{else}}
      <div ...attributes>{{yield}}</div>
    {{/if}}
    <style scoped>
      /* A disclosure inside the conversation (a tool row's panel, a
         thinking block) opens and closes at once, and the messages below
         take the change as one move. Its own height transition resized
         the content on every frame, and each resize is a render pass, so
         the move was recompiled from where it was painted on every frame:
         the messages below crawled, then snapped into place. */
      .transcript-region {
        --pretui-disclosure-duration: 0s;
      }
    </style>
  </template>
}

interface MessageSignature {
  Element: HTMLDivElement;
  Args: {
    /** the message is still streaming: its rows' reflow lands instantly */
    live?: boolean;
    /** the message cannot change now: its region sits render passes out */
    idle?: boolean;
  };
  Blocks: { default: [] };
}

/**
 * One message's parts: its tool rows (`role='row'`, declared on each row).
 * A row that arrives rises in; a row that leaves fades; a row that grew
 * (its steps settling into a result) shows its new size through a clip,
 * and the rows below it move down with it in the same run. While the
 * message streams, reflow is not named, so it lands as it renders.
 * Nested inside the transcript's region, so a message can grow and move
 * while its rows do (Choreo measures a nested region's pass on its own).
 */
export class MessageMotion extends Component<MessageSignature> {
  private enabled = motionEnabled();

  <template>
    {{#if this.enabled}}
      <Choreo
        @idle={{@idle}}
        @maxFrameStep={{MAX_FRAME_STEP}}
        ...attributes
        as |c|
      >
        {{yield}}
        <c.Parallel>
          {{#unless @live}}
            {{! in the message's own space: when the transcript moves the
                whole message (a follow, a fold above), the message carries
                its rows, and they don't travel the distance twice }}
            <c.Move
              @of={{c.moved 'row'}}
              @duration={{DURATION.move}}
              @ease={{EASE}}
              @size={{false}}
              @space='parent'
            />
          {{/unless}}
          <c.Tween
            @of={{c.inserted 'row'}}
            @opacity={{array 0 1}}
            @y={{array RISE 0}}
            @duration={{DURATION.enter}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.removed 'row'}}
            @opacity={{array 1 0}}
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
        </c.Parallel>
      </Choreo>
    {{else}}
      <div ...attributes>{{yield}}</div>
    {{/if}}
  </template>
}
