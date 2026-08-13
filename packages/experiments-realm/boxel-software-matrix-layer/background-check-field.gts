import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import { htmlSafe } from '@ember/template';

import { stateColor, stateColorOf, type StateColor } from './utils/index';

// Background-check lifecycle: not-started → pending → clear | flagged.
// This field TRACKS the status a human (or an external screening vendor's
// portal) reports — it never initiates or polls a check. Integration with a
// screening provider's API is explicitly out of scope per the product spec.
export const BACKGROUND_CHECK_STATUSES = [
  'not-started',
  'pending',
  'clear',
  'flagged',
];

export const BACKGROUND_CHECK_STATUS_LABELS: Record<string, string> = {
  'not-started': 'Not started',
  pending: 'Pending',
  clear: 'Clear',
  flagged: 'Flagged',
};

// Same Ledger palette every other status pill in the tracker draws from:
// gray for a check nobody has ordered yet, amber while the vendor works,
// green when it comes back clean, red when something needs a human look.
export const BACKGROUND_CHECK_STATUS_COLORS: Record<string, StateColor> = {
  'not-started': stateColor('slate'),
  pending: stateColor('amber'),
  clear: stateColor('green'),
  flagged: stateColor('red'),
};

export const BackgroundCheckStatusField = enumField(StringField, {
  options: BACKGROUND_CHECK_STATUSES.map((value) => ({
    value,
    label: BACKGROUND_CHECK_STATUS_LABELS[value],
  })),
  displayName: 'Background Check Status',
});

export class BackgroundCheckField extends FieldDef {
  static displayName = 'Background Check';

  @field status = contains(BackgroundCheckStatusField);
  @field provider = contains(StringField, {
    description: 'Screening vendor running the check, e.g. Checkr, Certn',
  });
  @field requestedDate = contains(DateField);
  @field completedDate = contains(DateField);
  @field notes = contains(TextAreaField, {
    description: 'Free-text detail, e.g. what was flagged and who reviewed it',
  });

  static embedded = class Embedded extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(
        BACKGROUND_CHECK_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get statusLabel(): string {
      let status = this.args.model?.status;
      return (
        (status && BACKGROUND_CHECK_STATUS_LABELS[status]) || 'Not started'
      );
    }

    <template>
      <div class='background-check'>
        <div class='bc-head'>
          <span class='pill' style={{this.statusPillStyle}}>
            <span class='pill-dot'></span>{{this.statusLabel}}
          </span>
          {{#if @model.provider}}
            <span class='bc-provider'>via {{@model.provider}}</span>
          {{/if}}
        </div>
        {{#if @model.requestedDate}}
          <dl class='bc-dates'>
            <div>
              <dt>Requested</dt>
              <dd><@fields.requestedDate /></dd>
            </div>
            {{#if @model.completedDate}}
              <div>
                <dt>Completed</dt>
                <dd><@fields.completedDate /></dd>
              </div>
            {{/if}}
          </dl>
        {{/if}}
        {{#if @model.notes}}
          <p class='bc-notes'>{{@model.notes}}</p>
        {{/if}}
      </div>
      <style scoped>
        .background-check {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          font-family: var(--font-sans, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
        .bc-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .bc-provider {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .bc-dates {
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.15rem var(--boxel-sp);
        }
        .bc-dates > div {
          display: flex;
          gap: 0.3rem;
          min-width: 0;
        }
        .bc-dates dt {
          flex: none;
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .bc-dates dd {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .bc-notes {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(
        BACKGROUND_CHECK_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get statusLabel(): string {
      let status = this.args.model?.status;
      return (
        (status && BACKGROUND_CHECK_STATUS_LABELS[status]) || 'Not started'
      );
    }

    <template>
      <span class='bc-atom' style={{this.statusPillStyle}}>
        <span class='bc-atom-dot'></span>{{this.statusLabel}}
      </span>
      <style scoped>
        .bc-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .bc-atom-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
      </style>
    </template>
  };
}
