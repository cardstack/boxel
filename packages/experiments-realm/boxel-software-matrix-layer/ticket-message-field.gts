import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import MarkdownField from '@cardstack/base/markdown';
import BooleanField from '@cardstack/base/boolean';
import enumField from '@cardstack/base/enum';
import MessageCircleIcon from '@cardstack/boxel-icons/message-circle';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import { StatePill } from './components/state-pill';
import type { FeedEntry } from './components/feed';
import { initialsOf } from './utils/index';

export const AUTHOR_ROLES = ['Customer', 'Agent', 'System'] as const;
export const VISIBILITIES = ['Public', 'Internal'] as const;

const AuthorRoleField = enumField(StringField, {
  displayName: 'Author Role',
  options: AUTHOR_ROLES as unknown as string[],
});

const VisibilityField = enumField(StringField, {
  displayName: 'Visibility',
  options: VISIBILITIES as unknown as string[],
});

/**
 * One entry in a ticket's conversation: a customer message, an agent reply, an
 * internal note, or something the system did.
 *
 * The spec models Message and Note as two separate cards. They are one field
 * here, because a conversation entry is never opened, queried or linked on its
 * own — making it a card buys forty orphan records per demo world and buys
 * nothing back. `visibility` is the whole difference between the two rows.
 *
 * The author is stored as a name, not a link. Prerendered views resolve no
 * links, and a thread that loses its attribution in a tile is worse than one
 * that cannot navigate to the author's card.
 */
export class TicketMessageField extends FieldDef {
  static displayName = 'Ticket Message';
  static icon = MessageCircleIcon;

  @field author = contains(StringField);
  @field authorRole = contains(AuthorRoleField);
  @field visibility = contains(VisibilityField);
  @field body = contains(MarkdownField);
  @field sentAt = contains(DateTimeField);
  @field isSlaEvent = contains(BooleanField, {
    description: 'Renders as a rule across the thread instead of a bubble.',
  });

  @field isInternal = contains(BooleanField, {
    computeVia: function (this: TicketMessageField) {
      return this.visibility === 'Internal';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: TicketMessageField) {
      let who = this.author?.trim() || 'Unknown';
      return this.visibility === 'Internal' ? `${who} (internal)` : who;
    },
  });

  /** Shape the generic Feed component consumes. */
  get feedEntry(): FeedEntry {
    let kind: FeedEntry['kind'] = this.isSlaEvent
      ? 'system'
      : this.visibility === 'Internal'
        ? 'private'
        : this.authorRole === 'Customer'
          ? 'outward'
          : 'inward';
    return {
      actor: this.author ?? undefined,
      initials: initialsOf(this.author),
      meta: [this.authorRole, formatStamp(this.sentAt)]
        .filter(Boolean)
        .join(' · '),
      body: this.body ?? undefined,
      at: this.sentAt ?? undefined,
      kind,
    };
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='msg {{if @model.isInternal "msg-internal"}}'>
        <header class='msg-head'>
          <span class='msg-author'>{{@model.author}}</span>
          {{#if @model.isInternal}}
            <StatePill @label='Internal' @hue='amber' />
          {{else}}
            <span class='msg-role'>{{@model.authorRole}}</span>
          {{/if}}
          <span class='msg-stamp'><@fields.sentAt /></span>
        </header>
        <div class='msg-body'><@fields.body /></div>
      </article>
      <style scoped>
        .msg {
          border: 1px solid var(--border, var(--boxel-200));
          border-left: 3px solid var(--primary, var(--boxel-highlight));
          border-radius: var(--boxel-border-radius-sm, 4px);
          overflow: hidden;
          font-family: var(--font-sans, var(--boxel-font-family));
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
        }
        /* An internal note is tinted across its whole width so it cannot be
           skimmed as one more reply. The cost of that confusion is telling a
           customer what you actually think of their ticket. */
        .msg-internal {
          border-left-color: var(--boxel-warning);
          background: color-mix(
            in oklch,
            var(--boxel-warning) 8%,
            var(--card, var(--boxel-light))
          );
        }
        .msg-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .msg-author {
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        .msg-stamp {
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .msg-body {
          padding: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='msg-atom'>
        <span class='msg-atom-author'>{{@model.author}}</span>
        {{#if @model.isInternal}}
          <span class='msg-atom-tag'>internal</span>
        {{/if}}
      </span>
      <style scoped>
        .msg-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.3rem;
          font-size: 0.8125rem;
        }
        .msg-atom-author {
          font-weight: 600;
        }
        .msg-atom-tag {
          font-size: 0.625rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--boxel-warning);
          font-weight: 700;
        }
      </style>
    </template>
  };
}

// boxel-ui's helper, not a local Intl call: it is today-aware (a message sent
// this morning reads as a time, not a date the reader has to compare against
// today's) and it is the same formatting every other card in the realm uses.
function formatStamp(at?: Date | null): string {
  if (!at) {
    return '';
  }
  let d = at instanceof Date ? at : new Date(at);
  if (isNaN(d.getTime())) {
    return '';
  }
  return formatDateTime(d, { preset: 'medium', fallback: '' }) ?? '';
}
