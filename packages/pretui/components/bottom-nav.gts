// Pretui — BottomNav: the mobile tab bar docked to the bottom of its pane — three to five destinations, labels always shown.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { VisuallyHidden } from './visually-hidden';

export interface BottomNavItem {
  id: string;
  label: string;
  /** A link destination. Without it the item is a button that reports @onChange. */
  href?: string;
  /** A short count or mark ('3', 'New'), shown by the label. */
  badge?: string;
  /** What the badge means, spoken after it ('unread' reads "3 unread"). */
  badgeLabel?: string;
  disabled?: boolean;
}

export interface BottomNavSignature {
  Args: {
    items: BottomNavItem[];
    /** Controlled current id. Omit for uncontrolled. */
    value?: string;
    defaultValue?: string;
    onChange?: (id: string) => void;
    /** The navigation landmark's name (default 'Primary'). */
    label?: string;
    /** 'sticky' (default) docks to the bottom of the scroll container; 'static' leaves it in flow. */
    position?: 'sticky' | 'static';
  };
  Blocks: {
    /** One item's icon, yielded the item and whether it is current. */
    icon: [item: BottomNavItem, current: boolean];
  };
  Element: HTMLElement;
}

/**
 * MUI BottomNavigation, as navigation rather than a widget: a named `<nav>`
 * landmark holding a list of links (or buttons, when there is no href), the
 * current one marked with `aria-current="page"`. Tabs switches content in
 * flow; Sidebar is the desktop rail.
 *
 * Labels are always visible — an icon-only bar makes every reader guess, and
 * MUI's `showLabels={false}` default is the thing this refuses. It docks to
 * the bottom of its scroll container with `position: sticky`, not to the
 * viewport, because a card is rarely the viewport; the safe-area inset pads
 * it clear of a phone's home indicator.
 */
export class BottomNav extends Component<BottomNavSignature> {
  @tracked private internal: string | undefined = this.args.defaultValue;

  /** Buttons default to the first item; links cannot know the current page, so they wait for @value. */
  get current(): string | undefined {
    let first = this.args.items?.[0];
    return this.args.value ?? this.internal ?? (first && !first.href ? first.id : undefined);
  }
  get rows() {
    return (this.args.items ?? []).map((item) => ({
      item,
      current: item.id === this.current,
      spokenBadge: item.badge ? `${item.badge}${item.badgeLabel ? ' ' + item.badgeLabel : ''}` : undefined,
    }));
  }
  choose = (item: BottomNavItem, event?: Event) => {
    if (item.disabled) {
      event?.preventDefault();
      return;
    }
    if (this.args.value === undefined) {
      this.internal = item.id;
    }
    this.args.onChange?.(item.id);
  };

  <template>
    <nav
      class='pretui-bottomnav'
      aria-label={{if @label @label 'Primary'}}
      data-position={{if @position @position 'sticky'}}
      data-test-pretui-bottom-nav
      ...attributes
    >
      <ul class='pretui-bottomnav-list'>
        {{#each this.rows key='item.id' as |row|}}
          <li class='pretui-bottomnav-cell'>
            {{#if row.item.href}}
              {{! A disabled link keeps role=link, a tab stop and its state: an anchor
                  without href would drop out of the accessibility tree. }}
              <a
                class='pretui-bottomnav-item'
                href={{if row.item.disabled undefined row.item.href}}
                role={{if row.item.disabled 'link'}}
                tabindex={{if row.item.disabled '0'}}
                aria-current={{if row.current 'page'}}
                aria-disabled={{if row.item.disabled 'true'}}
                data-current={{if row.current 'true' 'false'}}
                data-test-pretui-bottom-nav-item={{row.item.id}}
                {{on 'click' (fn this.choose row.item)}}
              >
                {{#if (has-block 'icon')}}<span class='pretui-bottomnav-icon' aria-hidden='true'>{{yield row.item row.current to='icon'}}</span>{{/if}}
                <span class='pretui-bottomnav-label'>{{row.item.label}}</span>
                {{#if row.item.badge}}<span class='pretui-bottomnav-badge' aria-hidden='true'>{{row.item.badge}}</span><VisuallyHidden>{{row.spokenBadge}}</VisuallyHidden>{{/if}}
              </a>
            {{else}}
              <button
                type='button'
                class='pretui-bottomnav-item'
                aria-current={{if row.current 'page'}}
                aria-disabled={{if row.item.disabled 'true'}}
                data-current={{if row.current 'true' 'false'}}
                data-test-pretui-bottom-nav-item={{row.item.id}}
                {{on 'click' (fn this.choose row.item)}}
              >
                {{#if (has-block 'icon')}}<span class='pretui-bottomnav-icon' aria-hidden='true'>{{yield row.item row.current to='icon'}}</span>{{/if}}
                <span class='pretui-bottomnav-label'>{{row.item.label}}</span>
                {{#if row.item.badge}}<span class='pretui-bottomnav-badge' aria-hidden='true'>{{row.item.badge}}</span><VisuallyHidden>{{row.spokenBadge}}</VisuallyHidden>{{/if}}
              </button>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    </nav>
    <style scoped>
      @layer PretComponent {
        .pretui-bottomnav {
          inset-block-end: 0;
          z-index: var(--pretui-z-sticky, 10);
          background: var(--pretui-bottomnav-bg, var(--card));
          box-shadow: 0 -1px 0 var(--border);
          padding-block-end: env(safe-area-inset-bottom, 0px);
          font-family: var(--font-sans);
        }
        .pretui-bottomnav[data-position='sticky'] {
          position: sticky;
        }
        .pretui-bottomnav-list {
          display: flex;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-bottomnav-cell {
          flex: 1 1 0;
          min-inline-size: 0;
        }
        .pretui-bottomnav-item {
          position: relative;
          display: grid;
          justify-items: center;
          gap: 0.125rem;
          inline-size: 100%;
          min-block-size: 3.5rem;
          padding: var(--space-2, 0.375rem) var(--space-1, 0.25rem);
          box-sizing: border-box;
          border: 0;
          background: transparent;
          color: var(--muted-foreground);
          font: inherit;
          font-size: var(--text-ui-xs, 0.66rem);
          text-decoration: none;
          cursor: pointer;
        }
        .pretui-bottomnav-item[data-current='true'] {
          color: var(--pretui-bottomnav-current, var(--primary));
          font-weight: 600;
        }
        .pretui-bottomnav-item[data-current='true']::before {
          content: '';
          position: absolute;
          inset-block-start: 0;
          inset-inline: 30%;
          block-size: 2px;
          border-radius: 0 0 2px 2px;
          background: currentColor;
        }
        .pretui-bottomnav-item[aria-disabled='true'] {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .pretui-bottomnav-item:hover {
          color: var(--foreground);
        }
        .pretui-bottomnav-item:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-bottomnav-icon {
          display: grid;
          place-items: center;
          block-size: 1.375rem;
        }
        .pretui-bottomnav-label {
          max-inline-size: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-bottomnav-badge {
          position: absolute;
          inset-block-start: 0.25rem;
          inset-inline-start: calc(50% + 0.5rem);
          min-inline-size: 1rem;
          padding-inline: 0.25rem;
          border-radius: 999px;
          background: var(--destructive);
          color: var(--card);
          font-size: 0.6rem;
          font-weight: 600;
          line-height: 1rem;
          text-align: center;
        }
      }
    </style>
  </template>
}
