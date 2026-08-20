import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import DateTimeField from '@cardstack/base/datetime';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import HistoryIcon from '@cardstack/boxel-icons/history';

import { Employee } from './employee';
import { Contract } from './contract';
import { StatePill } from './components/state-pill';
import type { Hue } from './components/state-pill';

/**
 * AUDIT ENTRY — the append-only record of what happened to a contract.
 *
 * WHY THIS IS ITS OWN CARD, not a field on Contract.
 * An audit trail's whole value is that it cannot be rewritten by the thing it
 * describes. A `containsMany` on Contract would be edited in the same save as
 * the contract itself, so "who approved this and when" would be as mutable as
 * the contract body — which is exactly the claim an auditor is trying to test.
 * A separate card with its own id gives each event a stable address that
 * survives edits to the contract.
 *
 * WHAT IS CONSUMED. `Employee` for the actor, `StatePill` for the action chip.
 * No new vocabulary is invented for either.
 *
 * WHAT IS NOT MODELLED. Nothing enforces append-only at the platform level —
 * the realm has no immutable-record primitive — so this is a convention the app
 * honours rather than a guarantee the storage makes. Said plainly here because
 * an audit trail that is only conventionally immutable must not be described as
 * if it were tamper-proof.
 */

export const AUDIT_ACTIONS = [
  { value: 'created', label: 'Created', hue: 'slate' },
  { value: 'submitted', label: 'Submitted for approval', hue: 'blue' },
  { value: 'approved', label: 'Approved', hue: 'green' },
  { value: 'approved_with_conditions', label: 'Approved with conditions', hue: 'teal' },
  { value: 'rejected', label: 'Rejected', hue: 'red' },
  { value: 'delegated', label: 'Delegated', hue: 'purple' },
  { value: 'on_hold', label: 'Placed on hold', hue: 'amber' },
  { value: 'resumed', label: 'Resumed', hue: 'blue' },
  { value: 'signed', label: 'Signed', hue: 'green' },
  { value: 'amended', label: 'Amended', hue: 'orange' },
  { value: 'renewed', label: 'Renewed', hue: 'green' },
  { value: 'terminated', label: 'Terminated', hue: 'red' },
] as const;

/**
 * A closed vocabulary, not free text.
 *
 * An audit trail whose action column accepts anything cannot be filtered,
 * charted or trusted — one entry saying "approved" and another "Approved!!"
 * are the same event to a person and two different events to a query.
 */
export const AuditActionField = enumField(StringField, {
  options: AUDIT_ACTIONS.map((a) => ({ value: a.value, label: a.label })),
  displayName: 'Audit Action',
  icon: HistoryIcon,
});

export function auditActionLabel(value?: string | null): string {
  return AUDIT_ACTIONS.find((a) => a.value === value)?.label ?? (value ?? '—');
}

export function auditActionHue(value?: string | null): Hue {
  return (AUDIT_ACTIONS.find((a) => a.value === value)?.hue ?? 'slate') as Hue;
}

export class AuditEntry extends CardDef {
  static displayName = 'Audit Entry';
  static icon = HistoryIcon;

  @field action = contains(AuditActionField);
  /**
   * Who did the thing.
   *
   * Named `doneBy` rather than `actor`: the edit form takes its label straight
   * from the field name, and "Actor" is a system word that made a reader ask
   * what it meant. "Done by" works for every action in the vocabulary —
   * created, approved, signed, amended, terminated.
   */
  @field doneBy = linksTo(() => Employee);
  @field occurredAt = contains(DateTimeField);

  /**
   * What the entry is about — a real link, not a stored id.
   *
   * An id string cannot be navigated to, cannot be queried with
   * `{ eq: { 'subject.id': ... } }`, and gives the reader no way to open the
   * thing being audited. The earlier version stored one to keep the entry
   * readable after the contract is deleted; a broken link renders as a broken
   * link and the snapshot below preserves what it was called, so that argument
   * bought nothing that `subjectTitle` was not already buying.
   */
  @field subject = linksTo(() => Contract);

  /**
   * The subject's title AS AT the moment of the entry.
   *
   * Deliberately denormalised. Reading through the link would show today's
   * title, and an audit trail is supposed to say what the thing was called
   * when the decision was made.
   */
  @field subjectTitle = contains(StringField);

  /** The reason given at the time. Never back-filled. */
  @field note = contains(TextAreaField);

  /** Set when the action was `approved_with_conditions`. */
  @field conditions = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: AuditEntry) {
      let who = this.doneBy?.cardTitle ?? 'Someone';
      return `${who} — ${auditActionLabel(this.action)}`;
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: AuditEntry) {
      return this.subjectTitle ?? '';
    },
  });

  static isolated = class Isolated extends Component<typeof AuditEntry> {
    get when(): string {
      let v = this.args.model?.occurredAt;
      if (!v) return 'Time not recorded';
      let d = new Date(v as any);
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
    }
    <template>
      <article class='ae-page'>
        <header class='hero'>
          <p class='kicker'><HistoryIcon role='presentation' />Audit entry</p>
          <h1>{{auditActionLabel @model.action}}</h1>
          <StatePill
            @label={{auditActionLabel @model.action}}
            @hue={{auditActionHue @model.action}}
            @dot={{true}}
          />
        </header>

        <dl class='glance'>
          <div><dt>Done by</dt><dd>{{if @model.doneBy @model.doneBy.cardTitle '—'}}</dd></div>
          <div><dt>When</dt><dd>{{this.when}}</dd></div>
          <div><dt>Subject</dt><dd>{{if @model.subjectTitle @model.subjectTitle '—'}}</dd></div>
        </dl>

        {{#if @model.conditions}}
          <section class='panel'>
            <h2>Conditions attached</h2>
            <p>{{@model.conditions}}</p>
          </section>
        {{/if}}

        {{#if @model.note}}
          <section class='panel'>
            <h2>Reason given</h2>
            <p>{{@model.note}}</p>
          </section>
        {{/if}}

        <p class='caveat'>Entries are written once and never edited. Nothing in
          the platform enforces that — it is a convention this app keeps, not a
          guarantee the storage makes.</p>
      </article>

      <style scoped>
        .ae-page {
          container-type: inline-size;
          container-name: ae-page;
          --panel-bg: color-mix(in oklch, var(--foreground, #111) 3%, transparent);
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          color: var(--foreground, #111);
          font-family: var(--font-sans, inherit);
        }
        .hero {
          display: flex;
          flex-direction: column;
          gap: 6px;
          align-items: flex-start;
          border-bottom: 2px solid var(--foreground, #111);
          padding-bottom: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, #6b7280);
        }
        .kicker :deep(svg) { width: max(14px, 1em); height: max(14px, 1em); }
        /* The heading is the one shout. The figure on the right supports it
           and is deliberately smaller — a card is opened for the thing it IS,
           and the number qualifies that rather than replacing it. */
        .hero h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          letter-spacing: -0.015em;
        }
        .glance {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
          gap: var(--boxel-sp);
          margin: 0;
        }
        .glance div { min-width: 0; }
        .glance dt {
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, #6b7280);
        }
        .glance dd {
          margin: 3px 0 0;
          font-size: var(--boxel-font-size);
          font-weight: 550;
        }
        .panel {
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          border-radius: var(--radius, 8px);
          background: var(--panel-bg);
        }
        .panel h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .panel p { margin: 0; line-height: 1.55; }
        .caveat {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, #6b7280);
          max-width: 68ch;
        }
        @container ae-page (width < 560px) {
          .glance { grid-template-columns: 1fr; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof AuditEntry> {
    <template>
      <article class='fit'>
        <span class='r-head'>
          <StatePill
            @label={{auditActionLabel @model.action}}
            @hue={{auditActionHue @model.action}}
            @dot={{true}}
          />
        </span>
        <span class='r-body'>{{if @model.doneBy @model.doneBy.cardTitle 'Not recorded'}}</span>
        <span class='r-meta'>{{if @model.subjectTitle @model.subjectTitle ''}}</span>
      </article>

      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
          overflow: hidden;
          font-family: var(--font-sans, inherit);
          --type-base: clamp(10px, min(calc(3px + 2.1cqi + 1cqb - 0.6 * var(--ar, 1)), 10cqb), 15px);
        }
        .r-head, .r-body, .r-meta { overflow: hidden; min-height: 0; }
        .r-body {
          font-size: calc(var(--type-base) * 1.15);
          font-weight: 650;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .r-meta {
          font-size: var(--type-base);
          line-height: 1.25;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @container fitted-card (height <= 65px) {
          .r-meta { display: none; }
        }
        @container fitted-card (height <= 45px) {
          .r-head { display: none; }
        }
      </style>
    </template>
  };
}
