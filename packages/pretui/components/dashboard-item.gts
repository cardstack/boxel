// Pretui — DashboardItem: one draggable, resizable cell of a DashboardGrid.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import type { SafeString } from '@ember/template';
import { registerDashboardItem, syncDashboardItem } from '../internal/structure-dashboard';
import type { AdjustMode, CellRegistry, DashboardHost, WidgetOptions } from '../internal/structure-dashboard';

// ── DashboardItem ────────────────────────────────────────────────────────

export interface DashboardItemSignature {
  Args: {
    /** stable id — must match the placement's id */
    id: string;
    /**
     * The grid that owns this cell. `DashboardGrid` supplies it. When it is
     * absent the cell renders as an inert box with no engine attachment and
     * no drag affordances, which is what read-only mode uses and what makes
     * the cell safe to drop into a static preview.
     */
    host?: DashboardHost;
    /** accessible label for the handle — normally the tile's title */
    label?: string;
    /**
     * True when the grid is CONTROLLED (`@onLayoutChange` supplied), which is
     * the only case where a later change to the placement below may be pushed
     * back into a live engine. See `DashboardGrid.controlled`.
     */
    live?: boolean;
    /** placement — the seed at registration, and the push value when @live */
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    /**
     * CSS-grid placement. Read-only mode ONLY — see ownership rule 5: an
     * editable cell must never bind `style`, because gridstack keeps the
     * live geometry there.
     */
    staticStyle?: SafeString;
  };
  Blocks: {
    /** the tile's own heading line */
    title: [];
    /** trailing controls in the tile's bar */
    actions: [];
    /** the tile body — anything at all */
    default: [];
  };
  Element: HTMLDivElement;
}

/**
 * One dashboard cell: a drag handle, a title bar, an actions slot, and a
 * body that takes arbitrary content.
 *
 * The two engine class names (`grid-stack-item` and `grid-stack-item-content`)
 * are on the element in BOTH modes and are part of the contract — the engine
 * stylesheet keys on them, and because it is scoped under
 * `.pretui-dashboard-plane`, a read-only plane (which never gets that class)
 * leaves them completely inert.
 */
export class DashboardItem extends Component<DashboardItemSignature> {
  get live(): boolean {
    return this.args.live === true;
  }
  // Captured ONCE, deliberately untracked. `{{#each}}` is keyed by id, so a
  // cell's id and host are fixed for its whole life — and reading them here
  // instead of inside the registration modifier is what keeps that modifier
  // free of tracked dependencies. See `registerDashboardItem`.
  private readonly cellHost = this.args.host;
  private readonly cellId = this.args.id;
  private readonly seed: WidgetOptions =
    this.args.x === undefined ||
    this.args.y === undefined ||
    this.args.w === undefined ||
    this.args.h === undefined
      ? { id: this.args.id, w: 3, h: 2, autoPosition: true }
      : {
          id: this.args.id,
          x: this.args.x,
          y: this.args.y,
          w: this.args.w,
          h: this.args.h,
        };

  private readonly registry: CellRegistry = {
    attach: (el: HTMLElement) =>
      this.cellHost?.attachItem(this.cellId, el, this.seed),
    detach: (el: HTMLElement) => this.cellHost?.detachItem(this.cellId, el),
  };

  private get editable(): boolean {
    return this.args.host?.editable ?? false;
  }

  private get adjusting(): boolean {
    return this.args.host?.isAdjusting(this.args.id) ?? false;
  }

  private get mode(): AdjustMode | null {
    return this.args.host?.adjustMode(this.args.id) ?? null;
  }

  private get label(): string {
    return this.args.label ?? this.args.id;
  }

  private get handleLabel(): string {
    if (this.mode === 'resize') {
      return `Resizing ${this.label}. Arrow keys change its size.`;
    }
    if (this.mode === 'move') {
      return `Moving ${this.label}. Arrow keys move it.`;
    }
    return `Move or resize ${this.label}`;
  }

  // `{{on}}` types its listener as `(event: Event) => void`, so the narrow
  // KeyboardEvent is asserted here rather than at every call site.
  private onKeydown = (event: Event) => {
    this.args.host?.onItemKeydown(
      this.args.id,
      this.label,
      event as KeyboardEvent,
    );
  };

  private onBlur = () => {
    this.args.host?.onItemBlur(this.args.id);
  };

  <template>
    <div
      class='pretui-dashboard-item grid-stack-item'
      data-test-pretui-dashboard-item={{@id}}
      style={{@staticStyle}}
      {{registerDashboardItem this.registry}}
      {{syncDashboardItem @host this.live @x @y @w @h}}
      ...attributes
    >
      <div class='pretui-dashboard-item-content grid-stack-item-content'>
        <div class='pretui-dashboard-item-bar'>
          {{#if this.editable}}
            {{! NOT a <button>: gridstack's drag engine skips mousedown on
                native interactive elements (its skip selector includes
                `button`), so a real button as the `handle` can never start a
                pointer drag. role='button' + tabindex keeps the keyboard
                path (Enter/Space/arrows all live in onItemKeydown). }}
            <span
              role='button'
              tabindex='0'
              class='pretui-dashboard-handle'
              data-test-pretui-dashboard-handle={{@id}}
              aria-label={{this.handleLabel}}
              aria-pressed={{if this.adjusting 'true' 'false'}}
              aria-describedby={{@host.hintId}}
              {{on 'keydown' this.onKeydown}}
              {{on 'blur' this.onBlur}}
            >
              <span class='pretui-dashboard-grip' aria-hidden='true'></span>
            </span>
          {{/if}}
          <span class='pretui-dashboard-item-title'>{{yield to='title'}}</span>
          <span
            class='pretui-dashboard-item-actions'
          >{{yield to='actions'}}</span>
        </div>
        <div class='pretui-dashboard-item-body'>{{yield}}</div>
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-dashboard-item {
          min-width: 0;
          min-height: 0;
        }
        .pretui-dashboard-item-content {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          min-width: 0;
          min-height: 0;
          border-radius: var(--pretui-dashboard-radius, var(--radius));
          background: var(--pretui-dashboard-tile, var(--card));
          color: var(--card-foreground);
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.2)
          );
        }
        .pretui-dashboard-item-bar {
          display: flex;
          align-items: center;
          gap: var(--space-2, 5px);
          padding: var(--space-2, 5px) var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-dashboard-item-title {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 600;
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--card-foreground);
        }
        .pretui-dashboard-item-actions {
          display: flex;
          align-items: center;
          gap: var(--space-1, 3px);
          flex: 0 0 auto;
        }
        .pretui-dashboard-item-body {
          min-width: 0;
          min-height: 0;
          overflow: auto;
          padding: 0 var(--space-3, 8px) var(--space-3, 8px);
        }

        /* The handle is the ONE focusable control the cell adds, and it is
           both the pointer drag source (gridstack binds it through its
           `handle` selector) and the keyboard move/resize entry point.
           Handle-only dragging is what keeps the rest of the tile — charts,
           buttons, links — interactive. */
        .pretui-dashboard-handle {
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          width: 22px;
          height: 22px;
          padding: 0;
          border: 0;
          border-radius: var(--radius-sm, 6px);
          background: transparent;
          color: var(--muted-foreground);
          cursor: grab;
          touch-action: none;
        }
        .pretui-dashboard-handle:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-dashboard-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-dashboard-handle[aria-pressed='true'] {
          background: color-mix(
            in oklch,
            var(--primary) 16%,
            var(--card)
          );
          color: color-mix(
            in oklch,
            var(--foreground) 16%,
            var(--primary)
          );
        }
        /* The grip: dot rows drawn with one radial gradient, so the still
           frame reads as "draggable" with no icon dependency (Law 8). */
        .pretui-dashboard-grip {
          width: 10px;
          height: 10px;
          background-image: radial-gradient(currentColor 1px, transparent 1.2px);
          background-size: 4px 4px;
          background-position: 1px 1px;
        }
        /* Coarse pointers get a 44px target without changing the visual box —
           the tap area grows through a pseudo-element instead. */
        @media (any-pointer: coarse) {
          .pretui-dashboard-handle {
            position: relative;
          }
          .pretui-dashboard-handle::after {
            content: '';
            position: absolute;
            inset: -11px;
          }
        }
      }
    </style>
  </template>
}
