import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';

import { stateColor, type Hue } from '../utils/index';

/**
 * One thing that happened, at a time, attributed to someone.
 *
 * Deliberately flat strings rather than card references: a feed is read far
 * more often than it is edited, it is frequently rendered somewhere that
 * cannot resolve links, and every consumer already holds the display names it
 * wants to show.
 */
export interface FeedEntry {
  id?: string;
  /** Who or what. Rendered as the entry's heading. */
  actor?: string;
  /** Two-letter fallback when there is no avatar image. */
  initials?: string;
  avatarUrl?: string;
  /** Right-hand side of the header: role, timestamp, channel. */
  meta?: string;
  body?: string;
  at?: Date;
  /**
   * outward — visible to the other party (a customer reply, a public comment)
   * inward  — the same conversation from our side
   * private — internal only; must never be mistaken for outward
   * system  — something the software did; rendered as a rule, not a bubble
   */
  kind?: 'outward' | 'inward' | 'private' | 'system';
  /** Overrides the kind's default colour, for consumers with their own scheme. */
  hue?: Hue;
}

interface Signature {
  Args: {
    entries: FeedEntry[];
    /** Newest first. Defaults to oldest first, which is how a thread reads. */
    newestFirst?: boolean;
    emptyMessage?: string;
    onSelect?: (entry: FeedEntry) => void;
  };
  Blocks: {
    /** Replace the body rendering while keeping the chrome. */
    entry?: [FeedEntry];
  };
  Element: HTMLElement;
}

const KIND_HUE: Record<string, Hue> = {
  outward: 'blue',
  inward: 'slate',
  private: 'amber',
  system: 'slate',
};

/**
 * A chronological record of what happened to something.
 *
 * The Structures layer has a Feed row with nothing behind it; the nearest
 * existing thing is base's `timeline.gts`, which presents a single value and
 * cannot hold a thread. This is the general form: entries, kinds, and the one
 * rule that matters — a private entry must be impossible to mistake for a
 * public one, because the cost of that mistake is telling a customer what you
 * really think of their ticket.
 */
export class Feed extends GlimmerComponent<Signature> {
  get ordered(): FeedEntry[] {
    let entries = [...(this.args.entries ?? [])].filter(Boolean);
    entries.sort((a, b) => {
      let at = a.at ? new Date(a.at).getTime() : 0;
      let bt = b.at ? new Date(b.at).getTime() : 0;
      return this.args.newestFirst ? bt - at : at - bt;
    });
    return entries;
  }

  styleFor = (entry: FeedEntry) => {
    let hue = entry.hue ?? KIND_HUE[entry.kind ?? 'inward'] ?? 'slate';
    let { ring, bg } = stateColor(hue);
    return htmlSafe(`--feed-rule: ${ring}; --feed-tint: ${bg};`);
  };

  select = (entry: FeedEntry) => {
    this.args.onSelect?.(entry);
  };

  <template>
    <div class='feed' ...attributes>
      {{#if this.ordered.length}}
        <ol class='feed-list'>
          {{#each this.ordered key='id' as |entry|}}
            <li
              class='feed-item feed-{{if entry.kind entry.kind "inward"}}'
              style={{this.styleFor entry}}
            >
              {{#if (eq entry.kind 'system')}}
                {{! A system event is a rule across the thread, not a bubble —
                    it happened TO the conversation rather than in it. }}
                <p class='feed-system'>
                  <span>{{entry.body}}</span>
                  {{#if entry.meta}}<span
                      class='feed-system-meta'
                    >{{entry.meta}}</span>{{/if}}
                </p>
              {{else}}
                <article class='feed-card'>
                  <header class='feed-head'>
                    {{#if entry.avatarUrl}}
                      <img class='feed-avatar' src={{entry.avatarUrl}} alt='' />
                    {{else if entry.initials}}
                      <span
                        class='feed-avatar feed-initials'
                      >{{entry.initials}}</span>
                    {{/if}}
                    <span class='feed-actor'>{{entry.actor}}</span>
                    {{#if (eq entry.kind 'private')}}
                      <span class='feed-tagline'>Internal — not sent to the
                        customer</span>
                    {{/if}}
                    <span class='feed-meta'>{{entry.meta}}</span>
                  </header>
                  <div class='feed-body'>
                    {{#if (has-block 'entry')}}
                      {{yield entry to='entry'}}
                    {{else}}
                      {{entry.body}}
                    {{/if}}
                  </div>
                </article>
              {{/if}}
            </li>
          {{/each}}
        </ol>
      {{else}}
        <p class='feed-empty'>{{if
            @emptyMessage
            @emptyMessage
            'Nothing has happened here yet.'
          }}</p>
      {{/if}}
    </div>

    <style scoped>
      .feed {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans, var(--boxel-font-family));
        color: var(--foreground, var(--boxel-dark));
      }
      .feed-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .feed-card {
        border: 1px solid var(--border, var(--boxel-200));
        border-left: 3px solid var(--feed-rule);
        border-radius: var(--boxel-border-radius-sm, 4px);
        overflow: hidden;
        background: var(--card, var(--boxel-light));
      }
      /* The private tint is the whole point of the block: an internal note is
         full width with a coloured ground, so it can never be skimmed as one
         more reply in the thread. */
      .feed-private .feed-card {
        background: var(--feed-tint);
      }
      .feed-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        background: var(--muted, var(--boxel-100));
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .feed-private .feed-head {
        background: transparent;
        border-bottom: 1px dashed var(--feed-rule);
      }
      .feed-avatar {
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 50%;
        flex: none;
        object-fit: cover;
      }
      .feed-initials {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.5625rem;
        font-weight: 700;
        background: var(--feed-rule);
        color: var(--background, var(--boxel-light));
      }
      .feed-actor {
        font-weight: 700;
        color: var(--foreground, var(--boxel-dark));
      }
      .feed-tagline {
        font-size: 0.625rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--feed-rule);
        font-weight: 700;
      }
      .feed-meta {
        margin-left: auto;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .feed-body {
        padding: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        /* Long unbroken strings — a pasted URL, a stack trace — otherwise
           push the whole thread sideways. */
        overflow-wrap: anywhere;
      }
      .feed-system {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .feed-system::before,
      .feed-system::after {
        content: '';
        height: 1px;
        flex: 1;
        background: var(--border, var(--boxel-200));
      }
      .feed-system-meta {
        font-variant-numeric: tabular-nums;
      }
      .feed-empty {
        margin: 0;
        padding: var(--boxel-sp) 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
        max-width: 60ch;
      }
    </style>
  </template>
}

export default Feed;
