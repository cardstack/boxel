import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

// Edit Section Nav — the sticky anchor rail for long grouped edit forms
// (edit-card Rule 0b). Editorial treatment: each section is a numbered stop
// (01, 02…) on a vertical rail; the active stop's number inverts into a
// filled ink chip and the label sharpens. Render-only: the consumer owns
// activeId and the scroll (this component never touches the DOM outside
// itself), and the consumer should mirror the active state on the target
// section itself (an outline ring) so the rail and the form agree on where
// the reader is.
//
// Colour (boxel-theming): this is a REUSABLE component, so it asserts no
// brand of its own (§4a) — it exposes two knobs, --edit-section-nav-ink /
// --edit-section-nav-ink-fg, for the consuming family to point at its brand
// pair. Unassigned, the rail defaults to the theme's own foreground/
// background pair inverted (a guaranteed-contrast pairing, §2) — never
// --primary, which the host's edit format maps to the mint highlight,
// exactly the wrong colour for a wayfinding rail.

export interface NavSection {
  id: string;
  label: string;
}

interface Signature {
  Args: {
    sections: NavSection[];
    activeId?: string;
    onSelect: (id: string, event: Event) => void;
    ariaLabel?: string;
  };
  Element: HTMLElement;
}

function pad(n: number): string {
  return String(n + 1).padStart(2, '0');
}

export class EditSectionNav extends GlimmerComponent<Signature> {
  index = (i: number) => pad(i);

  <template>
    <nav
      class='section-nav'
      aria-label={{if @ariaLabel @ariaLabel 'Form sections'}}
      ...attributes
    >
      {{#each @sections as |s i|}}
        <button
          type='button'
          class='stop {{if (eq @activeId s.id) "active"}}'
          aria-current={{if (eq @activeId s.id) 'true' 'false'}}
          {{on 'click' (fn @onSelect s.id)}}
        >
          <span class='stop-num'>{{this.index i}}</span>
          <span class='stop-label'>{{s.label}}</span>
        </button>
      {{/each}}
    </nav>
    <style scoped>
      .section-nav {
        /* consumer knobs first, then the theme's inverted fg/bg pair —
           both halves of the chip come from ONE pair, so they can't
           come apart under any theme */
        --nav-ink: var(
          --edit-section-nav-ink,
          var(--foreground, var(--boxel-dark))
        );
        --nav-ink-fg: var(
          --edit-section-nav-ink-fg,
          var(--background, var(--boxel-light))
        );
        --nav-muted: var(--muted-foreground, var(--boxel-450));
        --nav-rail: var(--border, var(--boxel-200));
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-left: 2px;
      }
      /* the rail the stops sit on */
      .section-nav::before {
        content: '';
        position: absolute;
        left: 13px;
        top: 10px;
        bottom: 10px;
        width: 1px;
        background: var(--nav-rail);
      }
      .stop {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        border: none;
        background: none;
        font: inherit;
        text-align: left;
        padding: 5px 8px 5px 0;
        cursor: pointer;
        border-radius: 6px;
      }
      .stop-num {
        width: 22px;
        height: 22px;
        flex: 0 0 auto;
        display: grid;
        place-content: center;
        font-size: 0.625rem;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        color: var(--nav-muted);
        background: var(--background, var(--boxel-light));
        border: 1px solid var(--nav-rail);
        border-radius: 999px;
        transition:
          background 160ms ease,
          color 160ms ease,
          border-color 160ms ease,
          transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .stop-label {
        font-size: 0.8125rem;
        color: var(--nav-muted);
        transition: color 160ms ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .stop:hover .stop-label,
      .stop:focus-visible .stop-label {
        color: var(--foreground, var(--boxel-dark));
      }
      .stop:hover .stop-num {
        border-color: var(--nav-ink);
        color: var(--nav-ink);
      }
      .stop:focus-visible {
        outline: 2px solid var(--nav-ink);
        outline-offset: 2px;
      }
      /* the active stop: number inverts into a filled ink chip */
      .stop.active .stop-num {
        background: var(--nav-ink);
        border-color: var(--nav-ink);
        color: var(--nav-ink-fg);
        transform: scale(1.12);
        box-shadow: 0 2px 8px -3px
          color-mix(in oklch, var(--nav-ink) 60%, transparent);
      }
      .stop.active .stop-label {
        color: var(--nav-ink);
        font-weight: 600;
      }
      @media (prefers-reduced-motion: reduce) {
        .stop-num {
          transition: none;
        }
        .stop.active .stop-num {
          transform: none;
        }
      }
      /* horizontal variant for narrow panels: the consumer flips this class */
      .section-nav.horizontal {
        flex-direction: row;
        flex-wrap: wrap;
        gap: var(--boxel-sp-5xs);
      }
      .section-nav.horizontal::before {
        display: none;
      }
    </style>
  </template>
}

export default EditSectionNav;
