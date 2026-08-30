import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { createDragControls, motion } from 'glimmer-motion';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * Everything the pointer says before it says "drag".
 *
 * A card with a grip. `dragListener=false` turns the card's OWN pointerdown
 * off, so the body is ordinary content again — selectable, clickable, and
 * still able to report a tap — and `dragControls.start(event)` from the grip
 * is the only way to lift it. That split is the whole reason the controls
 * object exists: without it, `drag=true` swallows every gesture the element
 * might otherwise have wanted.
 *
 * The tape on the right is the rest of the gesture surface, said out loud.
 * `onPanSessionStart` fires at pointerdown, BEFORE the threshold that decides
 * this is a drag; `onTap` and `onTapCancel` are the two ways a press ends,
 * and telling them apart is exactly what a press handler has to do by hand.
 */

/**
 * The snap home. There are no drop targets here, so every lift is a return —
 * and `dragSnapToOrigin` returns it by clamping the inertia to `{min: 0,
 * max: 0}`, which means the ride home is the BOUNCE spring, not the throw.
 */
const RETURN = {
  bounceDamping: 34,
  bounceStiffness: 520,
  power: 0.18,
  timeConstant: 210,
} as const;

interface Note {
  at: number;
  id: number;
  kind: 'drag' | 'hover' | 'press' | 'session';
  text: string;
}

export class Grip extends Component {
  /** one controls object, handed to the card and fired by the grip */
  controls = createDragControls();

  @tracked propagate = false;
  @tracked tape: Note[] = [];
  @tracked lifted = false;
  private seq = 0;
  private opened = 0;
  private last = 0;

  /**
   * The tape is a clock per BURST, not since page load: a gesture is a few
   * events milliseconds apart, and what teaches is their spacing, not their
   * absolute time. A gap longer than the pause below starts the clock again.
   */
  private say = (kind: Note['kind'], text: string) => {
    const now = performance.now();
    if (!this.opened || now - this.last > 900) {
      this.opened = now;
    }
    this.last = now;
    this.seq += 1;
    const at = Math.round(now - this.opened);
    this.tape = [{ at, id: this.seq, kind, text }, ...this.tape].slice(0, 7);
  };

  /**
   * The grip is not the draggable element — it is a button that starts the
   * draggable element's gesture. The event is forwarded because the session
   * needs the real pointer that opened it, not a synthetic one.
   */
  lift = (event: PointerEvent) => {
    this.controls.start(event);
    this.say('drag', 'controls.start(event)');
  };

  session = () => {
    this.say('session', 'onPanSessionStart — pointer down');
  };

  dragStart = () => {
    this.lifted = true;
    this.say('drag', 'onDragStart — past the threshold');
  };

  dragEnd = () => {
    this.lifted = false;
    this.say('drag', 'onDragEnd — snapping to origin');
  };

  pressStart = () => this.say('press', 'onTapStart');
  press = () => this.say('press', 'onTap — released on the element');
  pressCancel = () => this.say('press', 'onTapCancel — released off it');
  hoverIn = () => this.say('hover', 'onHoverStart');
  hoverOut = () => this.say('hover', 'onHoverEnd');

  toggle = () => {
    this.propagate = !this.propagate;
  };

  clear = () => {
    this.tape = [];
  };

  <template>
    <div class="ex grip-ex no-select" {{on "selectstart" preventSelect}}>
      <div class="grip-stage">
        <div
          class={{if this.lifted "grip-card is-lifted" "grip-card"}}
          {{motion
            drag=true
            dragControls=this.controls
            dragListener=false
            dragSnapToOrigin=true
            dragTransition=RETURN
            onDragStart=this.dragStart
            onDragEnd=this.dragEnd
            onPanSessionStart=this.session
            onTapStart=this.pressStart
            onTap=this.press
            onTapCancel=this.pressCancel
            onHoverStart=this.hoverIn
            onHoverEnd=this.hoverOut
          }}
        >
          <button
            type="button"
            class="grip-handle"
            aria-label="Drag this card"
            {{on "pointerdown" this.lift}}
          >
            <span class="grip-dots" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i><i></i>
            </span>
          </button>

          <div class="grip-body">
            <p class="grip-kicker">Take 04 · interior</p>
            <p class="grip-line">The card body keeps its own pointer. Select
              this sentence — the drag never starts.</p>
            <span
              class={{if this.propagate "grip-pin is-open" "grip-pin"}}
              {{motion
                drag=true
                dragPropagation=this.propagate
                dragSnapToOrigin=true
                dragTransition=RETURN
              }}
            >pin</span>
          </div>
        </div>
      </div>

      <aside class="grip-side">
        <div class="grip-controls">
          <button
            type="button"
            class={{if this.propagate "chip is-on" "chip"}}
            {{on "click" this.toggle}}
          >dragPropagation
            {{if this.propagate "on" "off"}}</button>
          <button
            type="button"
            class="chip"
            {{on "click" this.clear}}
          >clear</button>
        </div>
        <p class="grip-hint">{{if
            this.propagate
            "The pin drags, and the card comes with it — both sessions are open."
            "The pin drags alone: it locks the gesture and its parent never hears it."
          }}</p>

        <ol class="grip-tape" aria-live="polite" aria-label="Pointer events">
          {{#each this.tape key="id" as |note|}}
            <li class="grip-note is-{{note.kind}}">
              <span class="grip-at">{{note.at}}ms</span>
              <span class="grip-text">{{note.text}}</span>
            </li>
          {{else}}
            <li class="grip-note is-empty"><span class="grip-text">Hover the
                card. Press it. Then lift it by the grip.</span></li>
          {{/each}}
        </ol>
      </aside>
    </div>
  </template>
}

export default Grip;
