import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import AppWindow from '@cardstack/boxel-icons/app-window';
import FileText from '@cardstack/boxel-icons/file-text';
import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import List from '@cardstack/boxel-icons/list';

import { cardRefLabel } from '@cardstack/host/lib/reply-furniture';
import type { EntrySummary } from '@cardstack/host/tools/search-entries';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Args: { entries: EntrySummary[] };
  Element: HTMLDivElement;
}

// How many matches show before "N more"
const SHOWN = 3;
// The fit meter's ticks
const TICKS = 5;

interface Shown {
  url: string;
  title: string;
  kind: string;
  path: string;
  description?: string;
  icon: ComponentLike<{ Element: SVGElement }>;
  fit: number;
  ticks: { on: boolean }[];
  best: boolean;
}

const OPAQUE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,})$/i;
const HASH_PREFIX = /^[0-9a-f]{6}-/i;
// A catalog listing's type names what it lists: FieldListing is a field
const LISTING = /^(\w+?)Listing$/;

function segmentsOf(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return url.split('/').filter(Boolean);
  }
}

// Where the match lives, short enough for one line: its realm and its
// folder, without an opaque id or a folder's hash prefix
function shortPath(url: string): string {
  let segments = segmentsOf(url);
  if (segments.length > 2 && OPAQUE_ID.test(segments[segments.length - 1]!)) {
    // drop the id and the type folder it sits in
    segments = segments.slice(0, -2);
  }
  return segments
    .slice(-2)
    .map((segment) => segment.replace(HASH_PREFIX, ''))
    .join('/');
}

function kindOf(entry: EntrySummary): string {
  if (entry.specType) {
    return entry.specType;
  }
  let segments = segmentsOf(entry.url);
  let type = segments[segments.length - 2] ?? '';
  let listing = LISTING.exec(type);
  return listing ? listing[1]!.toLowerCase() : entry.kind;
}

function iconFor(entry: EntrySummary) {
  if (entry.kind === 'file') {
    return FileText;
  }
  switch (kindOf(entry).toLowerCase()) {
    case 'field':
      return List;
    case 'app':
      return AppWindow;
    default:
      return LayoutGrid;
  }
}

// What a run's searches found (realm.entries.search), best match first: what
// each match is, where it lives and how well it fits, as the reader would
// weigh them. The best three show; the rest wait behind "N more".
export default class FoundEntries extends Component<Signature> {
  @tracked private showAll = false;

  private get rows(): Shown[] {
    let entries = this.args.entries;
    let best = Math.max(...entries.map((e) => e.matchRelevance ?? 0), 0);
    return entries.map((entry, index) => {
      // fit relative to the best match: the best is full, an unranked one
      // (relevance 0 everywhere) reads as full too
      let fit = best
        ? Math.max(1, Math.round(((entry.matchRelevance ?? 0) / best) * TICKS))
        : TICKS;
      return {
        url: entry.url,
        title: entry.cardTitle || entry.name || cardRefLabel(entry.url),
        kind: kindOf(entry),
        path: shortPath(entry.url),
        description: entry.cardDescription || undefined,
        icon: iconFor(entry),
        fit,
        ticks: Array.from({ length: TICKS }, (_, tick) => ({
          on: tick < fit,
        })),
        best: index === 0,
      };
    });
  }

  private get shown() {
    return this.showAll ? this.rows : this.rows.slice(0, SHOWN);
  }

  private get more() {
    return this.rows.length - SHOWN;
  }

  private toggle = () => {
    this.showAll = !this.showAll;
  };

  <template>
    <div class='found' data-test-found-entries ...attributes>
      <div class='found-head'>
        <span>{{this.rows.length}}
          {{if (eq this.rows.length 1) 'match' 'matches'}}
          · best first</span>
        <span>fit</span>
      </div>
      {{#each this.shown as |row|}}
        <div
          class='found-row {{if row.best "is-best"}}'
          data-test-found-entry={{row.url}}
        >
          <span class='found-icon'><row.icon aria-hidden='true' /></span>
          <span class='found-body'>
            <span class='found-title-line'>
              <span class='found-title'>{{row.title}}</span>
              <span class='found-kind'>{{row.kind}}</span>
            </span>
            {{#if row.description}}
              <span class='found-description'>{{row.description}}</span>
            {{/if}}
            <span class='found-path'>{{row.path}}</span>
          </span>
          <span class='found-fit' role='img' aria-label='Fit: {{row.fit}} of 5'>
            {{#each row.ticks as |tick|}}
              <span class='tick {{if tick.on "is-on"}}'></span>
            {{/each}}
          </span>
        </div>
      {{/each}}
      {{#if (gt this.more 0)}}
        <button type='button' class='found-more' {{on 'click' this.toggle}}>
          {{if
            this.showAll
            'Fewer'
            (concat
              this.more (if (eq this.more 1) ' more match' ' more matches')
            )
          }}
        </button>
      {{/if}}
    </div>
    <style scoped>
      .found {
        display: flex;
        flex-direction: column;
        border-top: 1px solid
          color-mix(in oklch, var(--foreground) 8%, transparent);
        margin-top: var(--step-4, 4px);
      }
      .found-head {
        display: flex;
        justify-content: space-between;
        padding: var(--step-8, 8px) 0 var(--step-4, 4px);
        font-size: var(--type-caption, 11px);
        line-height: var(--leading-caption, 16px);
        color: var(--ink-3, var(--muted-foreground));
      }
      .found-row {
        display: grid;
        grid-template-columns: 1.625rem minmax(0, 1fr) auto;
        column-gap: var(--step-8, 8px);
        align-items: start;
        padding: var(--step-8, 8px) var(--step-8, 8px);
        margin-inline: calc(-1 * var(--step-8, 8px));
        border-radius: var(--round-chip, 4px);
      }
      .found-row.is-best {
        background: color-mix(
          in oklch,
          var(--primary, #00ebac) 7%,
          transparent
        );
      }
      .found-icon {
        width: 1.625rem;
        height: 1.625rem;
        border-radius: var(--round-chip, 4px);
        background: color-mix(in oklch, var(--foreground) 9%, transparent);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--foreground);
      }
      .found-icon svg {
        width: 0.9375rem;
        height: 0.9375rem;
      }
      .found-body {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .found-title-line {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .found-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .found-kind {
        flex-shrink: 0;
        font-family: var(--font-mono, monospace);
        font-size: 0.625rem;
        line-height: 1rem;
        padding: 0 6px;
        border-radius: 4px;
        background: color-mix(in oklch, var(--foreground) 12%, transparent);
        color: var(--ink-2, var(--foreground));
      }
      .found-description {
        font-size: var(--type-caption, 11px);
        line-height: 1.125rem;
        color: var(--ink-2, var(--muted-foreground));
      }
      .found-path {
        font-family: var(--font-mono, monospace);
        font-size: 0.6875rem;
        line-height: 1rem;
        color: var(--ink-3, var(--muted-foreground));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .found-fit {
        display: flex;
        gap: 2px;
        padding-top: 6px;
      }
      .tick {
        width: 4px;
        height: 12px;
        border-radius: 2px;
        background: color-mix(in oklch, var(--foreground) 14%, transparent);
      }
      .tick.is-on {
        background: var(--ink-2, var(--foreground));
      }
      .is-best .tick.is-on {
        background: var(--primary, #00ebac);
      }
      .found-more {
        align-self: flex-start;
        font: inherit;
        font-size: var(--type-caption, 11px);
        color: var(--ink-2, var(--foreground));
        background: none;
        border: 0;
        padding: var(--step-4, 4px) 0;
        cursor: pointer;
      }
    </style>
  </template>
}

function eq(a: unknown, b: unknown) {
  return a === b;
}
function gt(a: number, b: number) {
  return a > b;
}
function concat(...parts: unknown[]) {
  return parts.join('');
}
