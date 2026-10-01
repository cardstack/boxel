// Pretui — agentic territory, the conversation surface.
//
// Five components that live in and around an agent transcript, plus the one
// primitive all five needed:
//
//   Collapse        the collapse mechanism (grid 0fr→1fr + `inert`)
//   Composer          the prompt bar — modes, attachments, queue awareness
//   InteractiveInput  the agent asks for a TYPED value, then re-runs
//   Thinking          the reasoning-trace rail
//   CompactionChip    history compaction, rendered rather than silent
//   JumpChip          "new message" / "back to bottom" scroll orientation
//
// Source: `pretui-extractions/agent-work-items.md` items 7, 10, 11, 14, 15
// and the design mirror's `components/agentic/{Composer,Thinking}.jsx`.
//
// Everything here is a presentational shell over caller-supplied data: none
// of it owns a state machine, talks to a model, or keeps a transcript. The
// only state a component holds is its own disclosure/mode/draft, and every
// one of those is controllable from outside (pass the arg and you own it).
//
// **Better than the inspiration.** The design-mirror JSX these descend from
// (and the Claude/Copilot surfaces behind it) collapse content with
// `gridTemplateRows: 0fr` and `opacity: 0` alone — the collapsed subtree
// stays in the accessibility tree and stays tabbable, so a keyboard user
// tabs into a panel they cannot see. `Collapse` adds `inert`, which is the
// platform's own answer, and wires `aria-controls`/`aria-expanded` from ids
// the components mint themselves rather than asking the caller for one.
// Composer's mode note is a `role='status'` (upstream renders it as inert
// prose, so switching Ask→Act announces nothing); InteractiveInput is a real
// `<fieldset>` of native radios instead of a div soup of swatches, which is
// how it gets arrow keys, Home/End and grouped announcement for free.
//
// Realm laws observed throughout: no timers anywhere (every reveal is CSS
// with a precomputed delay), no `Date.now()`/`Math.random()`, no named
// container queries, boolean attributes bound as `true | undefined`, and the
// one event listener that exists (`scrollEdge`) lives in an `ember-modifier`
// and removes itself in the destructor.
//
// Every component here lives in its own module under components/; this
// module re-exports them so existing imports keep working.
//
// (the agentic-chat group)

// Pretui — Collapse: the kit's inline 0fr → 1fr collapse, shared by the agentic components (not a catalog component).
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// ── Collapse ───────────────────────────────────────────────────────────
// The kit's inline collapse: a grid whose single row animates 0fr → 1fr, so
// the panel grows to its own content height with no measured pixel value and
// no timer. Extracted here because Thinking, CompactionChip, TaskRow,
// DocReport and Recommendation all needed the identical mechanism — one
// implementation, correct once.
//
// The correctness that upstream copies of this trick miss: a zero-height
// grid row still contains a focusable, announced subtree. `inert` removes it
// from the tab order and the accessibility tree in one attribute, and it is
// bound as `true | undefined` because Glimmer assigns dynamic attributes
// through the DOM property — `inert={{''}}` would silently do nothing.

export interface CollapseSignature {
  Args: {
    /** whether the panel is revealed; the caller owns this */
    open?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const Collapse: TemplateOnlyComponent<CollapseSignature> =
  <template>
    <div
      class='pretui-disclosure'
      data-open={{if @open 'true'}}
      inert={{unless @open true}}
      data-test-pretui-disclosure
      ...attributes
    >
      <div class='pretui-disclosure-inner'>{{yield}}</div>
    </div>
    <style scoped>
      .pretui-disclosure {
        display: grid;
        grid-template-rows: 0fr;
        opacity: 0;
        transition:
          grid-template-rows var(--pretui-disclosure-duration, 320ms)
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1)),
          opacity 180ms linear;
      }
      .pretui-disclosure[data-open] {
        grid-template-rows: 1fr;
        opacity: 1;
      }
      .pretui-disclosure-inner {
        overflow: hidden;
        min-height: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-disclosure {
          transition: none;
        }
      }
    </style>
  </template>;
