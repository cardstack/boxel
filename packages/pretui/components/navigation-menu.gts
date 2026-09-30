// Pretui — NavigationMenu: a site's top navigation — links, and disclosure buttons that open a panel of links.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { listenDocument } from '../focus';

export interface NavigationMenuLink {
  id: string;
  label: string;
  href: string;
  /** One line under the label in a panel. */
  description?: string;
}

export interface NavigationMenuItem {
  id: string;
  label: string;
  /** A top-level destination. An item with `children` opens a panel instead. */
  href?: string;
  children?: NavigationMenuLink[];
}

export interface NavigationMenuSignature {
  Args: {
    items: NavigationMenuItem[];
    /** The navigation landmark's name (default 'Main'). */
    label?: string;
    /** Controlled open item id. Omit for uncontrolled. */
    value?: string | null;
    onValueChange?: (id: string | null) => void;
    /** Open a panel when the pointer rests on its trigger (default true). Click always works. */
    openOnHover?: boolean;
    /** The id of the current page's link or item, marked aria-current. */
    current?: string;
  };
  Blocks: {
    /** Replaces a panel's default link list — columns, a featured card. Yielded the item and a close action. */
    panel: [item: NavigationMenuItem, close: () => void];
  };
  Element: HTMLElement;
}

/**
 * Information architecture, not a command menu: Menu holds actions,
 * NavigationMenu holds destinations. So it follows the APG disclosure
 * navigation pattern rather than the menu pattern — top-level destinations
 * are real links, and an item with children is a button with
 * `aria-expanded` that shows a panel of real links. There are no
 * `role="menu"` semantics to fight, and Tab moves through everything.
 *
 * A panel opens on click, Enter or Space, and on hover unless
 * `@openOnHover` is off. It closes on Escape (focus returns to its button),
 * on a press outside, when focus leaves the navigation, and when the pointer
 * leaves it after a hover-open. Only one panel is open at a time.
 */
export class NavigationMenu extends Component<NavigationMenuSignature> {
  private guid = guidFor(this);
  @tracked private internal: string | null = null;
  private openedByHover = false;

  get openId(): string | null {
    return this.args.value !== undefined ? this.args.value : this.internal;
  }
  get openOnHover(): boolean {
    return this.args.openOnHover ?? true;
  }
  panelId(id: string): string {
    return `${this.guid}-panel-${id}`;
  }
  triggerId(id: string): string {
    return `${this.guid}-trigger-${id}`;
  }
  get rows() {
    return (this.args.items ?? []).map((item) => ({
      item,
      hasPanel: (item.children?.length ?? 0) > 0,
      open: item.id === this.openId,
      current: item.id === this.args.current || (item.children ?? []).some((c) => c.id === this.args.current),
      panelId: this.panelId(item.id),
      triggerId: this.triggerId(item.id),
      links: (item.children ?? []).map((link) => ({ link, current: link.id === this.args.current })),
    }));
  }

  private setOpen(id: string | null) {
    if (this.args.value === undefined) {
      this.internal = id;
    }
    this.args.onValueChange?.(id);
  }

  /** A mouse always enters a trigger before it clicks, so a click on a
   * hover-opened panel pins it open instead of closing it. */
  toggle = (id: string) => {
    let pin = this.openedByHover && this.openId === id;
    this.openedByHover = false;
    this.setOpen(pin || this.openId !== id ? id : null);
  };
  hover = (id: string) => {
    if (!this.openOnHover || this.openId === id) {
      return;
    }
    this.openedByHover = true;
    this.setOpen(id);
  };
  leave = (event: Event) => {
    // keyboard focus inside the navigation keeps the panel; hiding it would
    // drop focus to the page
    let root = event.currentTarget as HTMLElement;
    if (root.contains(document.activeElement)) {
      return;
    }
    if (this.openedByHover && this.openId !== null) {
      this.openedByHover = false;
      this.setOpen(null);
    }
  };
  close = () => {
    this.setOpen(null);
  };

  onKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || this.openId === null) {
      return;
    }
    let id = this.openId;
    event.preventDefault();
    event.stopPropagation();
    this.setOpen(null);
    document.getElementById(this.triggerId(id))?.focus();
  };
  onFocusOut = (event: Event) => {
    let root = event.currentTarget as HTMLElement;
    let next = (event as FocusEvent).relatedTarget as Node | null;
    if (this.openId !== null && next && !root.contains(next)) {
      this.setOpen(null);
    }
  };
  onOutside = (event: Event) => {
    if (this.openId === null) {
      return;
    }
    let target = event.target as Node | null;
    let root = target?.ownerDocument?.getElementById(this.guid);
    if (root && target && root.contains(target)) {
      return;
    }
    this.setOpen(null);
  };

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <nav
      id={{this.guid}}
      class='pretui-navmenu'
      aria-label={{if @label @label 'Main'}}
      data-test-pretui-navigation-menu
      {{on 'keydown' this.onKeydown}}
      {{on 'focusout' this.onFocusOut}}
      {{on 'pointerleave' this.leave}}
      {{listenDocument 'pointerdown' this.onOutside true}}
      ...attributes
    >
      <ul class='pretui-navmenu-list'>
        {{#each this.rows key='item.id' as |row|}}
          <li class='pretui-navmenu-cell'>
            {{#if row.hasPanel}}
              <button
                id={{row.triggerId}}
                type='button'
                class='pretui-navmenu-trigger'
                aria-expanded={{if row.open 'true' 'false'}}
                aria-controls={{row.panelId}}
                data-current={{if row.current 'true' 'false'}}
                data-test-pretui-navigation-trigger={{row.item.id}}
                {{on 'click' (fn this.toggle row.item.id)}}
                {{on 'pointerenter' (fn this.hover row.item.id)}}
              >
                {{row.item.label}}
                <span class='pretui-navmenu-caret' data-open={{if row.open 'true' 'false'}} aria-hidden='true'></span>
              </button>
              <div
                id={{row.panelId}}
                class='pretui-navmenu-panel'
                hidden={{if row.open false true}}
                data-test-pretui-navigation-panel={{row.item.id}}
              >
                {{#if (has-block 'panel')}}
                  {{yield row.item this.close to='panel'}}
                {{else}}
                  <ul class='pretui-navmenu-links'>
                    {{#each row.links key='link.id' as |entry|}}
                      <li>
                        <a
                          class='pretui-navmenu-link'
                          href={{entry.link.href}}
                          aria-current={{if entry.current 'page'}}
                          data-test-pretui-navigation-link={{entry.link.id}}
                        >
                          <span class='pretui-navmenu-link-label'>{{entry.link.label}}</span>
                          {{#if entry.link.description}}<span class='pretui-navmenu-link-desc'>{{entry.link.description}}</span>{{/if}}
                        </a>
                      </li>
                    {{/each}}
                  </ul>
                {{/if}}
              </div>
            {{else}}
              <a
                class='pretui-navmenu-trigger'
                href={{row.item.href}}
                aria-current={{if row.current 'page'}}
                data-current={{if row.current 'true' 'false'}}
                data-test-pretui-navigation-link={{row.item.id}}
              >{{row.item.label}}</a>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    </nav>
    <style scoped>
      .pretui-navmenu {
        position: relative;
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 0.78rem);
      }
      .pretui-navmenu-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1, 0.25rem);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-navmenu-trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        min-block-size: var(--pretui-control-h, 2.25rem);
        padding-inline: var(--space-3, 0.5rem);
        border: 0;
        border-radius: var(--radius-control, 6px);
        background: transparent;
        color: var(--foreground);
        font: inherit;
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
      }
      .pretui-navmenu-trigger:hover,
      .pretui-navmenu-trigger[aria-expanded='true'] {
        background: var(--hover, color-mix(in oklch, var(--foreground) 8%, transparent));
      }
      .pretui-navmenu-trigger[data-current='true'] {
        color: var(--primary);
      }
      .pretui-navmenu-trigger:focus-visible,
      .pretui-navmenu-link:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-navmenu-caret {
        inline-size: 0.35rem;
        block-size: 0.35rem;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        rotate: 45deg;
        translate: 0 -0.1rem;
        transition: rotate var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out);
      }
      .pretui-navmenu-caret[data-open='true'] {
        rotate: 225deg;
        translate: 0 0.1rem;
      }
      .pretui-navmenu-panel {
        position: absolute;
        inset-inline: 0;
        inset-block-start: calc(100% + 0.25rem);
        z-index: var(--pretui-z-dropdown, 60);
        padding: var(--space-4, 0.6875rem);
        border-radius: var(--radius-surface, 10px);
        background: var(--popover);
        color: var(--popover-foreground);
        box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.12));
      }
      .pretui-navmenu-panel[hidden] {
        display: none;
      }
      /* A transparent bridge over the gap above the panel, so a pointer
         moving down from a trigger never leaves the navigation on the way. */
      .pretui-navmenu-panel::before {
        content: '';
        position: absolute;
        inset-inline: 0;
        inset-block-end: 100%;
        block-size: 0.375rem;
      }
      .pretui-navmenu-links {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
        gap: var(--space-2, 0.375rem);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-navmenu-link {
        display: grid;
        gap: 0.125rem;
        padding: var(--space-2, 0.375rem) var(--space-3, 0.5rem);
        border-radius: var(--radius-control, 6px);
        color: inherit;
        text-decoration: none;
      }
      .pretui-navmenu-link:hover {
        background: var(--hover, color-mix(in oklch, var(--foreground) 8%, transparent));
      }
      .pretui-navmenu-link[aria-current='page'] .pretui-navmenu-link-label {
        color: var(--primary);
      }
      .pretui-navmenu-link-label {
        font-weight: 600;
      }
      .pretui-navmenu-link-desc {
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 0.72rem);
        line-height: 1.4;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-navmenu-caret {
          transition: none;
        }
      }
    </style>
  </template>
}
