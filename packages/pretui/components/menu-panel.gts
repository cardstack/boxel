// Pretui — MenuPanel: one rendered menu level, shared by Menu and Menubar.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { anchorTo } from '../internal/overlay';
import { focusWhen, rovingTabindex, safeEdgeFor } from '../focus';
import type { PopupPlacement } from '../internal/overlay';
import type { SafeEdge } from '../focus';
import type { MenuRow, Slot, MenuLevel } from '../internal/menu';

export interface MenuPanelSignature {
  Args: {
    /** the level to draw */
    level: MenuLevel;
    /** the element the panel is positioned against */
    anchor?: HTMLElement;
    placement: PopupPlacement;
    /** gap between anchor and panel, in px */
    distance: number;
    /** key of the row holding the composite's single tab stop */
    rovingKey?: string;
    /** true only while the keyboard is driving — a row takes REAL focus on
     * the render where it became the tab stop, never on a pointer path */
    navigating: boolean;
    /** keys of rows whose submenu is open, for `aria-expanded` */
    openKeys: string[];
    /** row element registry — called with the element on install and with
     * `undefined` on teardown. The caller stores these in a plain (untracked)
     * Map: a tracked write from inside a modifier body is a backtracking
     * re-render. */
    onItemElement?: (key: string, el: HTMLElement | undefined) => void;
    /** the row element this panel hangs off, for the safe-triangle edge */
    parentItem?: HTMLElement;
    /** receives the panel's near edge on placement and on resize */
    onEdge?: (edge: SafeEdge | undefined) => void;
  };
  Element: HTMLElement;
}

/**
 * One rendered menu level: the panel markup and its whole stylesheet, shared
 * by `Menu` and `Menubar`.
 *
 * It is deliberately dumb — no state, no keyboard, no open/close. Every
 * decision (which row is the tab stop, which submenus are open, where focus
 * goes next) belongs to the composite that owns the panel, because that is
 * the ONLY thing the two patterns disagree about. Sharing the markup means
 * the four item kinds, the `require-presentational-children` workaround, the
 * ellipsis, the drawn checkmark and the mixed-state dash cannot drift apart
 * between a dropdown and an application menu bar.
 */
export class MenuPanel extends Component<MenuPanelSignature> {
  isSeparatorSlot = (slot: Slot): boolean => slot.type === 'separator';
  isRoving = (row: MenuRow): boolean => row.key === this.args.rovingKey;
  isFocusTarget = (row: MenuRow): boolean =>
    this.args.navigating && row.key === this.args.rovingKey;
  isActive = (row: MenuRow): boolean => row.key === this.args.rovingKey;
  isExpanded = (row: MenuRow): string | undefined =>
    row.hasSubmenu
      ? this.args.openKeys.includes(row.key)
        ? 'true'
        : 'false'
      : undefined;

  captureItem = modifier((el: HTMLElement, [key]: [string]) => {
    this.args.onItemElement?.(key, el);
    return () => this.args.onItemElement?.(key, undefined);
  });

  /** Reports the panel's near edge for the safe triangle. Measured when the
   * panel opens and on resize — never per pointer event. */
  registerEdge = modifier(
    (el: HTMLElement, [parentItem]: [HTMLElement | undefined]) => {
      if (!parentItem || !this.args.onEdge) {
        return undefined;
      }
      let update = () => {
        let panel = el.getBoundingClientRect();
        let anchor = parentItem.getBoundingClientRect();
        this.args.onEdge?.(
          safeEdgeFor(panel, panel.left >= anchor.right - 4 ? 'right' : 'left'),
        );
      };
      update();
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('resize', update);
        this.args.onEdge?.(undefined);
      };
    },
  );

  <template>
    <menu
      class='pretui-menu'
      role='menu'
      aria-label={{@level.label}}
      data-depth={{@level.depth}}
      data-test-pretui-menu-panel={{@level.depth}}
      {{anchorTo @anchor @placement @distance false}}
      {{this.registerEdge @parentItem}}
      ...attributes
    >
      {{#each @level.slots key='key' as |slot|}}
        {{#if (this.isSeparatorSlot slot)}}
          <li class='pretui-menusep' role='separator'></li>
        {{else}}
          {{!-- one item markup for all four kinds. A labelled section becomes
                role='group'; a plain run wraps in a presentational one, which
                ARIA skips — so menu still sees menuitem children either way,
                and no kind gets a second markup that could drift. --}}
          <li
            class='pretui-menugroup'
            role='none'
            data-labelled={{if slot.label 'true'}}
          >
            {{#if slot.label}}
              <span
                class='pretui-menugroup-label'
                id={{slot.labelId}}
              >{{slot.label}}</span>
            {{/if}}
            <menu role={{slot.role}} aria-labelledby={{slot.labelId}}>
              {{#each slot.rows key='key' as |row|}}
                <li
                  class='pretui-menuitem'
                  role={{row.role}}
                  data-menu-key={{row.key}}
                  data-active={{if (this.isActive row) 'true'}}
                  data-destructive={{if row.destructive 'true'}}
                  data-default={{if row.isDefault 'true'}}
                  data-check={{row.check}}
                  data-submenu={{if row.hasSubmenu 'true'}}
                  aria-disabled={{if row.disabled 'true'}}
                  aria-checked={{row.checked}}
                  aria-haspopup={{row.haspopup}}
                  aria-expanded={{this.isExpanded row}}
                  aria-keyshortcuts={{row.keyshortcuts}}
                  {{rovingTabindex (this.isRoving row)}}
                  {{focusWhen (this.isFocusTarget row)}}
                  {{this.captureItem row.key}}
                >
                  {{#if row.icon}}
                    <row.icon class='pretui-menuicon' role='presentation' />
                  {{else}}
                    <span class='pretui-menucheck' aria-hidden='true'></span>
                  {{/if}}
                  <span class='pretui-menulabel'>{{row.label}}</span>
                  {{#if row.shortcut}}
                    <span
                      class='pretui-menukbd'
                      aria-hidden='true'
                    >{{row.shortcut}}</span>
                  {{/if}}
                  {{#if row.hasSubmenu}}
                    <span class='pretui-menuchevron' aria-hidden='true'></span>
                  {{/if}}
                </li>
              {{/each}}
            </menu>
          </li>
        {{/if}}
      {{/each}}
    </menu>

    <style scoped>
      .pretui-menu {
        /* anchored overlays must escape scroll clipping; measured on open
           only — never during prerender (lint warns, accepted, same as
           components/popup.gts) */
        position: fixed;
        top: 0;
        left: 0;
        /* Named, not invented. The kit's stacking components each picked their
           own number, which is why none of them can be ordered against the
           others; this consumes the shared scale and re-tints the moment the
           token lands. The palette needs no z-index at all — a native
           <dialog> lives in the top layer, above every stacking context. */
        z-index: var(--pretui-z-dropdown, 60);
        margin: 0;
        padding: var(--pretui-menu-padding, 5px);
        list-style: none;
        min-width: var(--pretui-menu-min-width, 200px);
        max-width: var(--pretui-menu-max-width, 320px);
        max-height: min(60vh, 520px);
        overflow-y: auto;
        overscroll-behavior: contain;
        background: var(--popover);
        color: var(--foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 8px 28px rgb(0 0 0 / 0.16)
        );
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 12.5px);
        opacity: 1;
        transform: none;
        transition:
          opacity 120ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-menu {
          opacity: 0;
          transform: translateY(-3px) scale(0.985);
        }
      }
      .pretui-menu menu {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-menugroup {
        display: block;
      }
      .pretui-menugroup[data-labelled='true'] {
        padding-block-start: 3px;
      }
      .pretui-menugroup-label {
        display: block;
        padding-block: 3px;
        padding-inline: 8px;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-menuitem {
        position: relative;
        display: grid;
        grid-template-columns: 15px 1fr auto;
        align-items: center;
        gap: 8px;
        min-height: var(--pretui-menu-item-height, 28px);
        padding-block: 3px;
        padding-inline: 6px 8px;
        border-radius: var(--radius-control, 6px);
        color: inherit;
        cursor: default;
        user-select: none;
        scroll-margin: 6px;
      }
      .pretui-menuitem[data-submenu='true'] {
        grid-template-columns: 15px 1fr auto auto;
      }
      .pretui-menuitem[data-default='true'] .pretui-menulabel {
        font-weight: 600;
      }
      .pretui-menuitem[data-destructive='true'] {
        color: var(--pretui-destructive-ink, var(--boxel-danger));
      }
      .pretui-menuitem[aria-disabled='true'] {
        /* dimmed, still focusable, still announced — HIG's "dim, don't
           remove", which the `disabled` attribute cannot express */
        opacity: 0.42;
      }
      .pretui-menuitem[data-active='true']:not([aria-disabled='true']) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-menuitem[data-active='true'][data-destructive='true'] {
        background: color-mix(
          in oklch,
          var(--destructive) 12%,
          var(--popover)
        );
      }
      .pretui-menuitem:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }
      .pretui-menulabel {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-menuicon {
        width: 14px;
        height: 14px;
        color: var(--muted-foreground);
      }
      .pretui-menukbd {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pretui-menuitem[data-active='true'] .pretui-menukbd {
        color: inherit;
      }

      /* The checkmark is drawn, not typed: a glyph inherits whatever the
         reader's emoji font does to it and ignores currentColor. */
      .pretui-menucheck {
        position: relative;
        width: 15px;
        height: 15px;
      }
      .pretui-menuitem[data-check='on'] .pretui-menucheck::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 4px;
        width: 5px;
        height: 9px;
        border: solid currentColor;
        border-width: 0 1.75px 1.75px 0;
        transform: rotate(43deg);
      }
      .pretui-menuitem[data-check='mixed'] .pretui-menucheck::after {
        /* the partial state a multi-selection produces — a dash, with
           aria-checked='mixed' carrying it to assistive tech */
        content: '';
        position: absolute;
        inset-block-start: 6px;
        inset-inline-start: 2px;
        width: 9px;
        height: 1.75px;
        background: currentColor;
        border-radius: 1px;
      }
      .pretui-menuchevron {
        position: relative;
        width: 10px;
        height: 10px;
        margin-inline-start: 2px;
      }
      .pretui-menuchevron::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 2px;
        width: 5px;
        height: 5px;
        border: solid currentColor;
        border-width: 1.5px 1.5px 0 0;
        transform: rotate(45deg);
        opacity: 0.75;
      }
      .pretui-menusep {
        height: 1px;
        margin-block: 4px;
        margin-inline: 6px;
        background: var(--border);
      }

      /* Touch: a 28px row is a miss target on a finger. */
      @media (any-pointer: coarse) {
        .pretui-menuitem {
          min-height: 44px;
        }
      }
      /* Reduced motion lands on the end state: with no transition the
         @starting-style values are never interpolated toward. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-menu {
          transition: none;
        }
      }
    </style>
  </template>
}
