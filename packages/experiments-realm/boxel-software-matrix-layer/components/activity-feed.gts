import GlimmerComponent from '@glimmer/component';

import { Feed, type FeedEntry } from './feed';
import type { Activity } from '../activity';

interface Signature {
  Args: {
    /** Activity cards, holes tolerated — unloaded/broken links are skipped. */
    activities?: (Activity | undefined)[];
    /** Streams read newest first; threads read oldest first. Default newest. */
    newestFirst?: boolean;
    emptyMessage?: string;
  };
  Element: HTMLElement;
}

function initialsOf(name: string | null | undefined): string | undefined {
  let parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return undefined;
  }
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/**
 * The record-layer feed: Activity cards rendered as a stream. A thin,
 * deliberate composition — Activity (what happened) is the layer-05 card
 * block, Feed (how a chronology reads) is the layer-03 component, and this
 * is the mapping between them, so no consumer writes it again. Status
 * changes render as system rules, everything else as entries with the
 * author's name.
 */
export class ActivityFeed extends GlimmerComponent<Signature> {
  get entries(): FeedEntry[] {
    return (this.args.activities ?? [])
      .filter(Boolean)
      .map((activity) => {
        let a = activity as Activity;
        let author = a.author?.name;
        return {
          id: a.id,
          actor: author ?? 'Someone',
          initials: initialsOf(author),
          meta: a.activityType ?? undefined,
          body: a.summary ?? undefined,
          at: a.occurredAt ?? undefined,
          kind: (a.activityType === 'status change'
            ? 'system'
            : 'inward') as FeedEntry['kind'],
        };
      });
  }

  get newestFirst() {
    return this.args.newestFirst ?? true;
  }

  <template>
    <Feed
      @entries={{this.entries}}
      @newestFirst={{this.newestFirst}}
      @emptyMessage={{if
        @emptyMessage
        @emptyMessage
        'Nothing has happened yet.'
      }}
      ...attributes
    />
  </template>
}

export default ActivityFeed;
