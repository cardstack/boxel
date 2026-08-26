import { Component } from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import CalendarPlusIcon from '@cardstack/boxel-icons/calendar-plus';

import { absoluteStamp, relativeStamp } from './utils/relative-time';

/**
 * When the record came into existence. Write-once: stamped at creation by the
 * command or author that made the record, never rewritten afterwards — the
 * block renders the fact, it does not enforce the discipline (a FieldDef
 * cannot see writes). Serializes exactly like DateTimeField, so an existing
 * `createdAt: DateTimeField` upgrades in place with no instance migration.
 */
export class CreatedAtField extends DateTimeField {
  static displayName = 'Created At';
  static icon = CalendarPlusIcon;

  static embedded = class Embedded extends Component<typeof this> {
    get absolute() {
      return absoluteStamp(this.args.model);
    }
    get relative() {
      return relativeStamp(this.args.model);
    }
    <template>
      {{#if this.absolute}}
        <span class='stamp'>{{this.absolute}}
          <span class='relative'>({{this.relative}})</span></span>
      {{else}}
        <span class='unset' aria-label='No creation time'>—</span>
      {{/if}}
      <style scoped>
        .stamp {
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .relative,
        .unset {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get absolute() {
      return absoluteStamp(this.args.model);
    }
    get relative() {
      return relativeStamp(this.args.model);
    }
    <template>
      {{#if this.relative}}
        <span class='stamp-atom' title={{this.absolute}}>{{this.relative}}</span>
      {{else}}
        <span class='unset' aria-label='No creation time'>—</span>
      {{/if}}
      <style scoped>
        .stamp-atom {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .unset {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export default CreatedAtField;
