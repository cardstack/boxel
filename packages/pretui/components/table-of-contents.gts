// Pretui — TableOfContents: a scroll-spy table of contents with one IntersectionObserver and a travelling marker.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { element } from '@cardstack/boxel-ui/helpers';
import { modifier } from 'ember-modifier';

// ── TableOfContents ──────────────────────────────────────────────────────
// Document navigation with a marker that TRAVELS between sections.
//
// Two mechanisms, both cheap: (1) section tracking is ONE IntersectionObserver
// over the heading elements, created inside a modifier and disconnected on
// cleanup — no scroll handler, no rAF, no re-measure per frame. The observer
// auto-roots on the nearest scrollable ancestor of the first heading, so a TOC
// beside a scrolling panel works without the caller wiring a root. (2) The
// active marker is one absolutely-positioned bar whose top/height follow the
// active link (Law 5's sliding highlight, measured in a modifier with a
// ResizeObserver for reflow). A SlidingHighlight primitive is landing in
// motion-core.gts in parallel; this local copy should be replaced by it once
// both are on the realm — the behaviour is identical, only vertical.
//
// Dropped from the docs-site originals: nested collapsible sub-lists (an
// accordion in a TOC hides the thing the reader came for; levels indent
// instead), and scroll-into-view on activation (that is the caller's
// scroll-behavior, not ours to seize).
//
// Two row modes, chosen the way the rest of the kit chooses: a row with an
// href is a link, a row without one is a button. Links (the default) are
// `<a href="#id">`, so the browser's fragment navigation scrolls the page.
// `@links={{false}}` drops the href and renders every row as a
// `<button type="button">`, so a caller whose sections live in its own
// scrolling panel (an edit form, a split view) does the scrolling itself from
// the @onSelect event's `currentTarget`. @onSelect only reports the click, in
// either mode; it never changes what renders.

export interface TocItem {
  /** the target element's DOM id — becomes the link's href fragment and
   * what the spy observes; with `@links={{false}}` it is whatever key the
   * caller needs */
  id: string;
  /** link text; override the rendering with the <:item> block */
  label: string;
  /** 1-based heading depth; 1 is flush, each level indents (default 1) */
  level?: number;
}

interface TocRow {
  item: TocItem;
  level: number;
  style: ReturnType<typeof htmlSafe>;
}

export interface TableOfContentsSignature {
  Args: {
    /** the document's sections, in document order */
    items: TocItem[];
    /** accessible name for the nav landmark (default 'On this page') */
    label?: string;
    /** controlled active id; omit for uncontrolled */
    activeId?: string;
    /** initial active id when uncontrolled (defaults to the first item) */
    defaultActiveId?: string;
    /** fires with the id whenever the active section changes — from a click
     * or from the observer */
    onActiveChange?: (id: string) => void;
    /** fires with the id and the click event when a row is clicked, in
     * either mode; it reports, and never changes what renders */
    onSelect?: (id: string, event: Event) => void;
    /** rows are `<a href="#id">` fragment links (default true). False renders
     * them as `<button type="button">` with no href: the component never
     * scrolls, and the caller does from the @onSelect event's
     * `currentTarget`. */
    links?: boolean;
    /** watch the document and follow the reader's scroll. Defaults to
     * @links: on for fragment links, off for buttons, whose ids need not be
     * DOM ids and would otherwise match unrelated elements in the document */
    spy?: boolean;
    /** how far down the viewport a heading must reach before it becomes
     * active, as a percentage (default 38 — the top ~38% is the read band) */
    band?: number;
  };
  Blocks: {
    /** replaces the row text; receives the item, whether it is active, and
     * its 0-based position in @items */
    item?: [item: TocItem, active: boolean, index: number];
  };
  Element: HTMLElement;
}

// Nearest scrollable ancestor — the IntersectionObserver root that makes the
// read band mean what it says inside a scrolling panel.
function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    let overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export class TableOfContents extends Component<TableOfContentsSignature> {
  @tracked private internalActive: string | undefined =
    this.args.defaultActiveId;

  get label(): string {
    return this.args.label ?? 'On this page';
  }
  get rows(): TocRow[] {
    return (this.args.items ?? []).map((item) => {
      let level = Math.max(1, Math.floor(item.level ?? 1));
      return { item, level, style: htmlSafe(`--_level: ${level}`) };
    });
  }
  get ids(): string[] {
    return (this.args.items ?? []).map((i) => i.id);
  }
  get activeId(): string | undefined {
    return (
      this.args.activeId ?? this.internalActive ?? this.args.items?.[0]?.id
    );
  }
  get links(): boolean {
    return this.args.links ?? true;
  }
  get rowTag(): 'a' | 'button' {
    return this.links ? 'a' : 'button';
  }
  get spy(): boolean {
    return this.args.spy ?? this.links;
  }
  get band(): number {
    return Math.min(90, Math.max(5, this.args.band ?? 38));
  }
  isActive = (row: TocRow): boolean => row.item.id === this.activeId;
  hrefFor = (row: TocRow): string => `#${row.item.id}`;

  private setActive(id: string) {
    if (this.args.activeId === undefined) {
      this.internalActive = id;
    }
    this.args.onActiveChange?.(id);
  }
  activate = (id: string, event: Event) => {
    this.setActive(id);
    this.args.onSelect?.(id, event);
  };
  private handleSpy = (id: string) => {
    this.setActive(id);
  };

  /** One observer for the whole document. Entries flow into a live set; the
   * active section is the FIRST item (document order) currently inside the
   * read band, which is what a reader would call "where I am". */
  sectionSpy = modifier(
    (
      el: HTMLElement,
      [ids, enabled, band, onActive]: [
        string[],
        boolean,
        number,
        (id: string) => void,
      ],
    ) => {
      if (!enabled || !ids.length) {
        return undefined;
      }
      let doc = el.ownerDocument;
      let targets = ids
        .map((id) => doc.getElementById(id))
        .filter((t): t is HTMLElement => !!t);
      if (!targets.length) {
        return undefined;
      }
      let inBand = new Set<string>();
      let observer = new IntersectionObserver(
        (entries) => {
          for (let entry of entries) {
            if (entry.isIntersecting) {
              inBand.add(entry.target.id);
            } else {
              inBand.delete(entry.target.id);
            }
          }
          let first = ids.find((id) => inBand.has(id));
          if (first) {
            onActive(first);
          }
        },
        {
          root: scrollParent(targets[0]),
          rootMargin: `0px 0px -${100 - band}% 0px`,
          threshold: 0,
        },
      );
      for (let target of targets) {
        observer.observe(target);
      }
      return () => observer.disconnect();
    },
  );

  /** Measures the active link and parks the travelling marker on it. No
   * timers: it runs on arg change and on reflow (ResizeObserver, disconnected
   * on cleanup). */
  marker = modifier((list: HTMLElement, [activeId]: [string | undefined]) => {
    let apply = () => {
      let active: HTMLElement | undefined;
      let links = list.querySelectorAll('[data-toc-id]');
      for (let i = 0; i < links.length; i++) {
        let candidate = links[i] as HTMLElement;
        if (candidate.dataset.tocId === activeId) {
          active = candidate;
          break;
        }
      }
      if (!active) {
        list.style.setProperty('--pretui-toc-marker-opacity', '0');
        return;
      }
      list.style.setProperty('--pretui-toc-marker-opacity', '1');
      list.style.setProperty('--pretui-toc-marker-top', `${active.offsetTop}px`);
      list.style.setProperty(
        '--pretui-toc-marker-height',
        `${active.offsetHeight}px`,
      );
    };
    apply();
    let observer = new ResizeObserver(apply);
    observer.observe(list);
    return () => observer.disconnect();
  });

  <template>
    <nav
      class='pretui-toc'
      aria-label={{this.label}}
      data-test-pretui-toc
      {{this.sectionSpy this.ids this.spy this.band this.handleSpy}}
      ...attributes
    >
      <div class='pretui-toc-track' {{this.marker this.activeId}}>
        {{! the marker is chrome: a sibling of the list, never a list item }}
        <span class='pretui-toc-marker' aria-hidden='true'></span>
        {{! role='list' is not redundant: list-style:none strips list
            semantics in Safari/VoiceOver, and the lint rule allows ol+list }}
        <ol class='pretui-toc-list' role='list'>
          {{#let (element this.rowTag) as |Row|}}
            {{#each this.rows key='item.id' as |row index|}}
              <li class='pretui-toc-row' style={{row.style}}>
                <Row
                  class='pretui-toc-link'
                  href={{if this.links (this.hrefFor row)}}
                  type={{unless this.links 'button'}}
                  data-toc-id={{row.item.id}}
                  data-active={{if (this.isActive row) 'true'}}
                  aria-current={{if (this.isActive row) 'location'}}
                  {{on 'click' (fn this.activate row.item.id)}}
                >
                  {{#if (has-block 'item')}}
                    {{yield row.item (this.isActive row) index to='item'}}
                  {{else}}
                    {{row.item.label}}
                  {{/if}}
                </Row>
              </li>
            {{/each}}
          {{/let}}
        </ol>
      </div>
    </nav>
    <style scoped>
      @layer PretComponent {
        .pretui-toc {
          min-width: 0;
          font-size: var(--boxel-font-size-xs);
        }
        .pretui-toc-track {
          position: relative;
          padding-left: var(--pretui-toc-rail-gap, var(--boxel-sp-sm));
        }
        /* the rail the marker travels down */
        .pretui-toc-track::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 1px;
          background-color: var(--border);
        }
        .pretui-toc-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--boxel-sp-6xs);
        }
        .pretui-toc-marker {
          position: absolute;
          left: 0;
          width: 2px;
          border-radius: 1px;
          background-color: var(--primary-ink);
          top: var(--pretui-toc-marker-top, 0);
          height: var(--pretui-toc-marker-height, 0);
          opacity: var(--pretui-toc-marker-opacity, 0);
          transition:
            top 220ms var(--pretui-ease-snap, cubic-bezier(0.2, 0.8, 0.2, 1)),
            height 220ms var(--pretui-ease-snap, cubic-bezier(0.2, 0.8, 0.2, 1));
        }
        .pretui-toc-row {
          padding-left: calc(
            var(--pretui-toc-indent, var(--boxel-sp-sm)) * (var(--_level, 1) - 1)
          );
          min-width: 0;
        }
        .pretui-toc-link {
          display: block;
          padding: var(--boxel-sp-3xs) var(--boxel-sp-2xs);
          border-radius: var(--boxel-border-radius-sm);
          color: var(--muted-foreground);
          text-decoration: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transition-property: color, background-color;
          transition-duration: 140ms;
          transition-timing-function: var(--pretui-ease-snap, ease);
        }
        /* button mode: the same row, without the button's own chrome */
        button.pretui-toc-link {
          width: 100%;
          border: 0;
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          text-align: start;
        }
        .pretui-toc-link:hover {
          color: var(--foreground);
          background-color: var(--hover);
        }
        .pretui-toc-link[data-active='true'] {
          color: var(--foreground);
          font-weight: 500;
        }
        .pretui-toc-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* reduced motion keeps the END state (the marker is already parked on
           the active row), it just stops travelling */
        @media (prefers-reduced-motion: reduce) {
          .pretui-toc-marker,
          .pretui-toc-link {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
