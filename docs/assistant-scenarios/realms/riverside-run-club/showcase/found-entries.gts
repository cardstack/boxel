// What a run's searches found, best match first: a copy of the host's
// FoundEntries (host/app/components/matrix/found-entries.gts on the
// pretui-ui-top6 branch) that a realm can load. The host version imports
// cardRefLabel from host's lib/reply-furniture, which a card cannot, so the
// label helper lives here.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ComponentLike } from '@glint/template';

import AppWindow from '@cardstack/boxel-icons/app-window';
import FileText from '@cardstack/boxel-icons/file-text';
import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import List from '@cardstack/boxel-icons/list';

import { Button } from './kit/components/button';
import type { CatalogEntry } from './story';

interface Signature {
  Args: { entries: CatalogEntry[] };
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
const QUERY_OR_HASH = /[?#]/;
const TRAILING_SLASHES = /\/+$/;
const FILE_EXTENSION = /\.[a-z0-9]{1,5}$/i;
const JSON_EXTENSION = /\.json$/i;
const WORD_BREAK = /[-_\s]+/;
// A catalog listing's type names what it lists: FieldListing is a field
const LISTING = /^(\w+?)Listing$/;

// A card's name from its URL, as the host's cardRefLabel words it
function cardRefLabel(url: string): string {
  let segments = url
    .split(QUERY_OR_HASH)[0]!
    .replace(TRAILING_SLASHES, '')
    .split('/');
  let last = segments.pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // keep the raw segment
  }
  // an opaque id names nothing: the folder its type sits in names the card
  if (
    OPAQUE_ID.test(last.replace(JSON_EXTENSION, '')) &&
    segments.length >= 2
  ) {
    let folder = segments[segments.length - 2]!.replace(HASH_PREFIX, '');
    if (folder && !OPAQUE_ID.test(folder)) {
      last = folder;
    }
  }
  if (FILE_EXTENSION.test(last) && !JSON_EXTENSION.test(last)) {
    return last;
  }
  return last
    .replace(JSON_EXTENSION, '')
    .split(WORD_BREAK)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

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

function kindOf(entry: CatalogEntry): string {
  if (entry.specType) {
    return entry.specType;
  }
  let segments = segmentsOf(entry.url);
  let type = segments[segments.length - 2] ?? '';
  let listing = LISTING.exec(type);
  return listing ? listing[1]!.toLowerCase() : entry.kind;
}

function iconFor(entry: CatalogEntry) {
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

export class FoundEntries extends Component<Signature> {
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
        title: entry.cardTitle || cardRefLabel(entry.url),
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

  private get moreLabel() {
    if (this.showAll) {
      return 'Fewer';
    }
    return `${this.more} ${this.more === 1 ? 'more match' : 'more matches'}`;
  }

  private get countLabel() {
    let n = this.rows.length;
    return `${n} ${n === 1 ? 'match' : 'matches'}, best first`;
  }

  private toggle = () => {
    this.showAll = !this.showAll;
  };

  <template>
    <div class='found' ...attributes>
      <div class='found-head'>
        <span>{{this.countLabel}}</span>
        <span>fit</span>
      </div>
      {{#each this.shown key='url' as |row|}}
        <div class='found-row' data-best={{if row.best 'true'}}>
          <span class='found-icon'><row.icon
              width='15'
              height='15'
              aria-hidden='true'
            /></span>
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
              <span class='tick' data-on={{if tick.on 'true'}}></span>
            {{/each}}
          </span>
        </div>
      {{/each}}
      {{#if (gt this.more 0)}}
        <Button
          class='found-more'
          @size='xs'
          @tone='neutral'
          @appearance='plain'
          {{on 'click' this.toggle}}
        >{{this.moreLabel}}</Button>
      {{/if}}
    </div>
    <style scoped>
      .found {
        display: flex;
        flex-direction: column;
        border-top: 1px solid
          color-mix(in oklch, var(--foreground) 8%, transparent);
        margin-top: var(--step-4);
      }
      .found-head {
        display: flex;
        justify-content: space-between;
        padding: var(--step-8) 0 var(--step-4);
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--ink-3);
      }
      .found-row {
        display: grid;
        grid-template-columns: 1.625rem minmax(0, 1fr) auto;
        column-gap: var(--step-8);
        align-items: start;
        padding: var(--step-8);
        margin-inline: calc(-1 * var(--step-8));
        border-radius: var(--round-chip);
      }
      .found-row[data-best] {
        background-color: color-mix(in oklch, var(--primary) 7%, transparent);
      }
      .found-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.625rem;
        height: 1.625rem;
        border-radius: var(--round-chip);
        background-color: color-mix(in oklch, var(--foreground) 9%, transparent);
        color: var(--foreground);
      }
      .found-body {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }
      .found-title-line {
        display: flex;
        align-items: center;
        gap: var(--step-4);
        min-width: 0;
      }
      .found-title {
        overflow: hidden;
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .found-kind {
        flex-shrink: 0;
        padding: 0 var(--step-4);
        border-radius: var(--round-chip);
        background-color: color-mix(in oklch, var(--foreground) 12%, transparent);
        color: var(--ink-2);
        font-family: var(--font-mono);
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
      }
      .found-description {
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--ink-2);
      }
      .found-path {
        overflow: hidden;
        font-family: var(--font-mono);
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--ink-3);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .found-fit {
        display: flex;
        gap: 0.125rem;
        padding-top: var(--step-4);
      }
      .tick {
        width: 0.25rem;
        height: 0.75rem;
        border-radius: 0.125rem;
        background-color: color-mix(in oklch, var(--foreground) 14%, transparent);
      }
      .tick[data-on] {
        background-color: var(--ink-2);
      }
      .found-row[data-best] .tick[data-on] {
        background-color: var(--primary);
      }
      .found-more {
        --pretui-button-px: 0;
        align-self: flex-start;
        margin-top: var(--step-4);
      }
    </style>
  </template>
}

function gt(a: number, b: number) {
  return a > b;
}
