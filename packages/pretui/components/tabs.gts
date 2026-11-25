// Pretui — Tabs: tablist + yielded panel. The underline is the same
// SlidingHighlight SegmentedControl wears, in its underline cut.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { listen, rovingTabindex } from '../focus';
import { slidingHighlight, SlidingHighlight } from './sliding-highlight';
import { emit, firstDefined } from '../pretui-primitives';
import type { SegmentOption } from './segmented-control';

export interface TabsSignature {
  Args: {
    options?: SegmentOption[];
    /** alias — the canonical flat-collection noun */
    items?: SegmentOption[];
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    /** alias — the HTML/Mantine/Ant notify name */
    onChange?: (value: string) => void;
    /** the tab list's accessible name */
    label?: string;
    /** 'scroll' lets a list that doesn't fit scroll sideways, with an edge
     * fade and the selected tab kept in view; unset, tabs shrink to fit */
    overflow?: 'scroll';
  };
  Blocks: { default: [active: string] };
  Element: HTMLDivElement;
}

interface TabView {
  option: SegmentOption;
  id: string;
  active: boolean;
  /** the list's one tab stop */
  stop: boolean;
}

const STEP: Record<string, (index: number, count: number) => number> = {
  next: (i, n) => (i + 1) % n,
  previous: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

function stepFor(event: KeyboardEvent, list: HTMLElement) {
  let rtl = getComputedStyle(list).direction === 'rtl';
  switch (event.key) {
    case 'ArrowRight':
      return STEP[rtl ? 'previous' : 'next'];
    case 'ArrowLeft':
      return STEP[rtl ? 'next' : 'previous'];
    default:
      return STEP[event.key];
  }
}

// Scroll mode: keep the selected tab in view, and mark which physical edges
// hide tabs so the CSS fades only those.
const scrollTabs = modifier(
  (list: HTMLElement, [enabled, _value]: [boolean, string | undefined]) => {
    if (!enabled) {
      return;
    }
    let edges = () => {
      let sl = Math.abs(list.scrollLeft);
      let start = sl > 1;
      let end = sl + list.clientWidth < list.scrollWidth - 1;
      let rtl = getComputedStyle(list).direction === 'rtl';
      list.toggleAttribute('data-fade-left', rtl ? end : start);
      list.toggleAttribute('data-fade-right', rtl ? start : end);
    };
    let active = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (active) {
      let a = active.getBoundingClientRect();
      let l = list.getBoundingClientRect();
      if (a.left < l.left) {
        list.scrollLeft -= l.left - a.left;
      } else if (a.right > l.right) {
        list.scrollLeft += a.right - l.right;
      }
    }
    edges();
    let resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(edges);
    resize?.observe(list);
    list.addEventListener('scroll', edges, { passive: true });
    return () => {
      resize?.disconnect();
      list.removeEventListener('scroll', edges);
    };
  },
);

// The underline is the same shared primitive the SegmentedControl wears, in
// its `underline` cut: one <SlidingHighlight /> travelling along the rail
// instead of an ::after grown on whichever tab happens to be active. The
// modifier goes on the tablist rather than the outer wrapper so the yielded
// panel's own content can never be mistaken for the active tab.
export class Tabs extends Component<TabsSignature> {
  @tracked internal =
    this.args.defaultValue ??
    (this.args.options ?? this.args.items ?? [])[0]?.value;
  get options(): SegmentOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  pick = (option: SegmentOption) => {
    if (this.args.value === undefined) {
      this.internal = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
  };
  get scrolls() {
    return this.args.overflow === 'scroll';
  }
  private guid = guidFor(this);
  get panelId() {
    return `${this.guid}-panel`;
  }
  // APG Tabs: one tab stop for the whole list, on the active tab, or on the
  // first tab when no option matches the value.
  get tabs(): TabView[] {
    let activeIndex = this.options.findIndex((o) => o.value === this.value);
    let stop = activeIndex === -1 ? 0 : activeIndex;
    return this.options.map((option, index) => ({
      option,
      id: `${this.guid}-tab-${index}`,
      active: index === activeIndex,
      stop: index === stop,
    }));
  }
  get activeTabId() {
    return this.tabs.find((tab) => tab.active)?.id;
  }
  // Automatic activation: the arrow keys move focus and select together,
  // which APG recommends when every panel renders without a fetch.
  // A modified key is the browser's or the page's (Alt+Left is Back).
  onKeydown = (event: Event) => {
    if (
      !(event instanceof KeyboardEvent) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    let list = event.currentTarget as HTMLElement;
    let step = stepFor(event, list);
    let tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    let index = tabs.indexOf(event.target as HTMLElement);
    let option = step ? this.options[step(index, tabs.length)] : undefined;
    if (!option || index === -1) {
      return;
    }
    event.preventDefault();
    this.pick(option);
    // A controlled parent may refuse the change; focus stays with the
    // selection rather than landing on a tab that isn't selected.
    if (this.value === option.value) {
      tabs[this.options.indexOf(option)]?.focus();
    }
  };
  <template>
    <div data-test-pretui-tabs ...attributes>
      <div
        class='pretui-tabs'
        role='tablist'
        aria-label={{@label}}
        data-overflow={{@overflow}}
        {{slidingHighlight}}
        {{scrollTabs this.scrolls this.value}}
        {{listen 'keydown' this.onKeydown}}
      >
        <SlidingHighlight @variant='underline' @thickness={{2}} @radius={{0}} />
        {{#each this.tabs key='id' as |tab|}}
          <button
            type='button'
            role='tab'
            id={{tab.id}}
            aria-selected={{if tab.active 'true' 'false'}}
            aria-controls={{if (has-block) this.panelId}}
            class='pretui-tab'
            data-state={{if tab.active 'active'}}
            data-test-pretui-tab={{tab.option.value}}
            {{rovingTabindex tab.stop}}
            {{on 'click' (fn this.pick tab.option)}}
          >{{tab.option.label}}</button>
        {{/each}}
      </div>
      {{#if (has-block)}}
        <div
          role='tabpanel'
          id={{this.panelId}}
          aria-labelledby={{this.activeTabId}}
          tabindex='0'
          class='pretui-tabpanel'
          data-test-pretui-tabpanel
        >{{yield this.value}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* the 1px rail is an inset shadow, so it stays put while a
           scrolling list moves its tabs */
        .pretui-tabs {
          position: relative;
          display: flex;
          gap: 0.625rem;
          box-shadow: inset 0 -1px var(--border);
          isolation: isolate;
        }
        /* the mask gradient is alpha only; black is not a colour here */
        .pretui-tabs[data-overflow='scroll'] {
          --_tabs-fade-left: 0px;
          --_tabs-fade-right: 0px;
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
          mask-image: linear-gradient(
            to right,
            transparent,
            black var(--_tabs-fade-left),
            black calc(100% - var(--_tabs-fade-right)),
            transparent
          );
        }
        .pretui-tabs[data-overflow='scroll'] .pretui-tab {
          flex-shrink: 0;
        }
        .pretui-tabs[data-overflow='scroll']::-webkit-scrollbar {
          display: none;
        }
        .pretui-tabs[data-fade-left] {
          --_tabs-fade-left: var(--pretui-tabs-fade, 1.5rem);
        }
        .pretui-tabs[data-fade-right] {
          --_tabs-fade-right: var(--pretui-tabs-fade, 1.5rem);
        }
        .pretui-tab {
          position: relative;
          height: 34px;
          padding: 0 0.5rem;
          border: 0;
          background: none;
          font-family: inherit;
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 500;
          letter-spacing: inherit;
          color: var(--muted-foreground);
          cursor: pointer;
          transition: color 150ms var(--pretui-ease-snap, ease);
        }
        @media (hover: hover) {
          .pretui-tab:hover {
            color: var(--foreground);
          }
        }
        /* inset, so a scrolling list never clips it and nothing moves; the
           host's unlayered button focus rule reads its offset from
           --host-outline-offset. The 1px --foreground stroke inside the ring
           keeps 3:1 against the surface when --ring is a light hue. The
           focused tab drops below the SlidingHighlight so the selection
           underline stays visible over the ring. */
        .pretui-tab:focus-visible {
          --host-outline-offset: -2px;
          z-index: -1;
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          box-shadow: inset 0 0 0 3px var(--foreground);
        }
        .pretui-tab[data-state='active'] {
          color: var(--foreground);
        }
        /* the 2px accent bar is the shared SlidingHighlight in its underline
           cut: bottom edge of the tab box, square ends via a zero radius */
        .pretui-tabpanel {
          padding-top: var(--space-4, 11px);
        }
      }
    </style>
  </template>
}
