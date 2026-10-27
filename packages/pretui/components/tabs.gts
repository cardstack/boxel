// Pretui — Tabs: tablist + yielded panel. The underline is the same
// SlidingHighlight SegmentedControl wears, in its underline cut.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
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
        {{slidingHighlight}}
        {{listen 'keydown' this.onKeydown}}
      >
        <div class='pretui-tabs-rail'></div>
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
        .pretui-tabs {
          position: relative;
          display: flex;
          gap: 22px;
        }
        .pretui-tab {
          position: relative;
          height: 34px;
          padding: 0 2px;
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
        .pretui-tab:hover {
          color: var(--foreground);
        }
        .pretui-tab[data-state='active'] {
          color: var(--foreground);
        }
        /* the 2px accent bar is the shared SlidingHighlight in its underline
           cut, same geometry (bottom
           edge of the tab box, square ends via a zero radius) */
        .pretui-tabs-rail {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: var(--border);
        }
        .pretui-tabpanel {
          padding-top: var(--space-4, 11px);
        }
      }
    </style>
  </template>
}
