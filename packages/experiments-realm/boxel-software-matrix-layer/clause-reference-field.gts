import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import BooleanField from '@cardstack/base/boolean';
import LinkIcon from '@cardstack/boxel-icons/link';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { Clause, clauseTypeLabel } from './clause';
import { StatePill } from './components/state-pill';

/**
 * Clause Reference (CR) — a pointer from a document into the clause library:
 * WHICH approved clause, at WHICH section number, pinned to WHICH revision.
 *
 * The pin is the point. A library clause is re-reviewed over time, and "we
 * used the liability cap" means nothing unless you know whether it was the
 * cap as approved in June or the one rewritten in November. An amendment that
 * says "§ 4 is replaced" must therefore record the revision of § 4 it was
 * looking at. Without the pin, the clause library rewrites history every time
 * it improves.
 *
 * Domain-neutral: an Amendment uses this to list changed sections, a
 * Playbook uses it to cite a standard, a Deviation Approval uses it to say
 * which clause was conceded.
 */
export class ClauseReferenceField extends FieldDef {
  static displayName = 'Clause Reference';
  static icon = LinkIcon;

  @field clause = linksTo(() => Clause);
  /** Where it sits in the document — "§ 8.2", "Schedule 3, para 4". */
  @field section = contains(StringField);
  /** The library clause's `reviewedAt` that was in force when referenced. */
  @field pinnedRevision = contains(DateField);

  /**
   * True when the library clause has been re-reviewed since this reference
   * was pinned — the standard moved under the document. Not a defect in the
   * document; a prompt to re-read it.
   */
  @field isSuperseded = contains(BooleanField, {
    computeVia: function (this: ClauseReferenceField) {
      let pinned = this.pinnedRevision ? new Date(this.pinnedRevision) : null;
      let current = this.clause?.reviewedAt
        ? new Date(this.clause.reviewedAt)
        : null;
      if (!pinned || !current) return false;
      return current.getTime() > pinned.getTime();
    },
  });

  @field label = contains(StringField, {
    computeVia: function (this: ClauseReferenceField) {
      let sec = this.section?.trim();
      let name = this.clause?.name?.trim();
      if (sec && name) return `${sec} · ${name}`;
      return sec || name || 'Unreferenced clause';
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='cr-atom'>
        <LinkIcon class='cr-icon' role='presentation' />
        {{#if @model.section}}
          <span class='cr-section'>{{@model.section}}</span>
        {{/if}}
        <span class='cr-name'>{{if
            @model.clause
            @model.clause.name
            'Unreferenced clause'
          }}</span>
        {{#if @model.isSuperseded}}
          <StatePill @label='superseded' @hue='amber' />
        {{/if}}
      </span>
      <style scoped>
        .cr-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .cr-icon {
          width: 12px;
          height: 12px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .cr-section {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 600;
          white-space: nowrap;
        }
        .cr-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get typeLabel() {
      return clauseTypeLabel(this.args.model?.clause?.clauseType);
    }
    get pinnedLabel() {
      let d = this.args.model?.pinnedRevision;
      if (!d) return 'no revision pinned';
      return `pinned to revision of ${new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`;
    }
    <template>
      <div class='cr'>
        <div class='cr-head'>
          {{#if @model.section}}
            <span class='cr-section'>{{@model.section}}</span>
          {{/if}}
          <span class='cr-name'>{{if
              @model.clause
              @model.clause.name
              'Unreferenced clause'
            }}</span>
          {{#if @model.clause}}
            <StatePill @label={{this.typeLabel}} @chrome={{true}} />
          {{/if}}
          {{#if @model.isSuperseded}}
            <StatePill @label='library moved' @hue='amber' @dot={{true}} />
          {{/if}}
        </div>
        <p class='cr-pin'>{{this.pinnedLabel}}{{#if @model.isSuperseded}}
            · the library clause was re-reviewed since — re-read before relying
            on it{{/if}}</p>
      </div>
      <style scoped>
        .cr {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .cr-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .cr-section {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
        }
        .cr-name {
          font-weight: 600;
        }
        .cr-pin {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

/** Edit — section, clause, pin on one line; computed `isSuperseded`/`label` hidden,
 *  but the superseded state is stated as helper text so the editor sees it. */
ClauseReferenceField.edit = class Edit extends Component<typeof ClauseReferenceField> {
  <template>
    <div class='cr-edit'>
      <FieldContainer @label='Section' @vertical={{true}}>
        <@fields.section />
      </FieldContainer>
      <FieldContainer @label='Library clause' @vertical={{true}}>
        <@fields.clause />
      </FieldContainer>
      <FieldContainer @label='Pinned to revision of' @vertical={{true}}>
        <@fields.pinnedRevision />
      </FieldContainer>
      {{#if @model.isSuperseded}}
        <p class='cr-warn'>The library clause has been re-reviewed since this pin
          — re-read it before relying on this reference.</p>
      {{/if}}
    </div>
    <style scoped>
      .cr-edit {
        container-type: inline-size;
        display: grid;
        grid-template-columns: 6rem minmax(0, 1fr) 11rem;
        gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
        align-items: start;
      }
      .cr-warn {
        grid-column: 1 / -1;
        margin: 0;
        font-size: 0.75rem;
        color: color-mix(in oklch, var(--boxel-warning) 65%, var(--foreground, var(--boxel-dark)));
      }
      @container (max-width: 480px) {
        .cr-edit {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
};

export default ClauseReferenceField;
