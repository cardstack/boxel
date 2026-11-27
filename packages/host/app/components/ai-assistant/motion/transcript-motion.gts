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
 * Where each message starts in this pass, top to bottom.
 *
 * A kept message starts where it was painted and takes its new size at
 * once (translate only, so text never scales). A message that grew
 * therefore draws its new bottom at once, and the message below it,
 * starting where it was painted, would sit under that bottom until both
 * landed. So no message starts above the block above it: its start is at
 * least that block's, and on one clock the two keep their gap in every
 * frame (ADR 013 §1.10, §1.20). A message that grew pushes the ones below
 * down at once, as layout does, and a message that shrank lets them glide
 * up.
 *
 * An arrival is fixed to the block above the same way: it starts where
 * that block's move puts it and travels on its clock. Following, the
 * block above starts a follow's distance lower and so does the arrival;
 * with nothing above it moving, it rises its usual few px.
 */
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
  let above: number | undefined;
  for (let s of stack) {
    let start: Start;
    if (s.type === 'inserted') {
      start = above
        ? { y: above, travelling: true }
        : { y: RISE, travelling: false };
    } else {
      let painted = -(s.delta?.y ?? 0);
      start = {
        y: above === undefined ? painted : Math.max(painted, above),
        travelling: false,
      };
    }
    known.set(s, start);
    above = start.y;
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
