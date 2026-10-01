// Pretui — Dock: a macOS-style dock whose items magnify toward the pointer.
import Component from '@glimmer/component';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { cssNumber } from '../pretui-css';
import { styleVar } from '../internal/structure-scenes';

// ── Dock — TRANSCRIBED from motion-primitives Dock ───────────────────────
// Magnifying shortcut rail. The original tracks mouseX as a motion value
// and gives every item a spring-smoothed width from its cursor DISTANCE
// (continuous falloff over a 150px window, mass/stiffness/damping
// physics). This transcription is CSS-only: a discrete 3-level sibling
// falloff — the hovered (or keyboard-focused) item scales to 1.4×, its
// immediate neighbors to 1.2× (next sibling via `+`, previous via
// `:has(+ :hover)`), everything else rests at 1.0× — animated by a plain
// width/height transition. Documented deltas vs the cursor-distance
// original: magnification follows the hovered ELEMENT, not the pointer
// position within it; the falloff window is exactly one sibling rather
// than a px radius; no spring physics; no DockLabel tooltip (items carry
// title= from @label); adjacency does not light up around a focused item
// (CSS has no sibling-of-:focus-visible in both directions — the focused
// item itself still magnifies). Items grow upward out of the rail
// (align-items: flex-end), pushing siblings apart exactly like the
// original's width animation. Reduced motion: the transition is removed —
// magnification snaps instantly instead of animating.

export interface DockSignature {
  Args: {
    /** base item size in px — default 40 */
    size?: number;
    /** accessible toolbar label — default 'Dock' */
    label?: string;
  };
  Blocks: {
    /** yields { Item } — the magnifying slots */
    default: [{ Item: typeof DockItem }];
  };
  Element: HTMLDivElement;
}

interface DockItemSignature {
  Args: {
    /** accessible name (and title tooltip) for the item */
    label: string;
    onClick?: (e: Event) => void;
  };
  Blocks: {
    /** the glyph — size it 100%×100% to ride the magnification */
    default: [];
  };
  Element: HTMLButtonElement;
}

class DockItem extends Component<DockItemSignature> {
  handleClick = (e: Event) => {
    this.args.onClick?.(e);
  };
  <template>
    <button
      type='button'
      class='pretui-dock-item'
      aria-label={{@label}}
      title={{@label}}
      data-test-pretui-dock-item
      {{on 'click' this.handleClick}}
      ...attributes
    >
      <span class='pretui-dock-item-glyph' aria-hidden='true'>
        {{yield}}
      </span>
    </button>
    <style scoped>
      .pretui-dock-item {
        --pretui-dock-scale: 1;
        width: calc(var(--pretui-dock-size, 40px) * var(--pretui-dock-scale));
        height: calc(var(--pretui-dock-size, 40px) * var(--pretui-dock-scale));
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: calc(var(--radius-surface, 10px) * 0.8);
        background: var(--inset, var(--boxel-100));
        color: var(--muted-foreground);
        box-shadow: 0 0 0 1px var(--border);
        cursor: pointer;
        transition:
          width var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease),
          height var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
      }
      .pretui-dock-item:hover,
      .pretui-dock-item:focus-visible {
        --pretui-dock-scale: 1.4;
        color: var(--foreground);
      }
      /* one-sibling falloff: next via `+`, previous via :has() */
      .pretui-dock-item:hover + .pretui-dock-item,
      .pretui-dock-item:has(+ .pretui-dock-item:hover) {
        --pretui-dock-scale: 1.2;
      }
      .pretui-dock-item:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-dock-item-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 55%;
        height: 55%;
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-dock-item {
          transition: none;
        }
      }
    </style>
  </template>
}

export class Dock extends Component<DockSignature> {
  get sizeStyle(): string {
    return styleVar(
      '--pretui-dock-size',
      `${cssNumber(this.args.size, 0, 512) ?? 40}px`,
    );
  }
  <template>
    <div
      class='pretui-dock'
      role='toolbar'
      aria-label={{if @label @label 'Dock'}}
      style={{this.sizeStyle}}
      data-test-pretui-dock
      ...attributes
    >
      {{yield (hash Item=DockItem)}}
    </div>
    <style scoped>
      /* The rail's height is pinned to the RESTING item size; magnified
         items grow upward past the rail top (overflow stays visible),
         pushing siblings apart like the original's width animation. */
      .pretui-dock {
        display: inline-flex;
        align-items: flex-end;
        gap: var(--space-3, 8px);
        height: calc(var(--pretui-dock-size, 40px) + 2 * var(--space-3, 8px));
        padding: var(--space-3, 8px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow:
          0 0 0 1px var(--border),
          var(--pretui-shadow-card, 0 1px 3px rgba(20, 18, 26, 0.1));
      }
    </style>
  </template>
}
