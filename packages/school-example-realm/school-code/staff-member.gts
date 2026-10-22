import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import IdBadgeIcon from '@cardstack/boxel-icons/id-badge';

// A person on the school's staff roster. The roster lives in the Org realm,
// which no instructor can read, and it is the one place a deployment says who
// its staff are: `matrixUserId` is the account a person signs in to Boxel
// with, and it is the only value here that differs between environments.
//
// A policy predicate cannot follow a link to this card. `actor()` is the
// caller's Matrix user id as a string, and a predicate reads the stored source
// of the card it judges, where a link is only a URL. So each card that links
// to staff also stores their ids in a plain list beside the links — the
// mirror the policy reads. See `Classroom.teacherIds`.
export class StaffMember extends CardDef {
  static displayName = 'Staff Member';
  static icon = IdBadgeIcon;

  @field fullName = contains(StringField);
  @field role = contains(StringField);
  @field matrixUserId = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: StaffMember) {
      return this.fullName?.length
        ? this.fullName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='staff'>
        <h1>{{@model.fullName}}</h1>
        <p class='role'>{{@model.role}}</p>
        <dl>
          <dt>Boxel account</dt>
          <dd class='mono'>{{@model.matrixUserId}}</dd>
        </dl>
      </article>
      <style scoped>
        .staff {
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          line-height: var(--boxel-line-height-xl);
        }
        .role {
          margin: 0;
          color: var(--muted-foreground);
        }
        dl {
          margin: var(--boxel-sp) 0 0;
        }
        dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
        }
        .mono {
          font-family: var(--font-mono, monospace);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='staff-row'>
        <strong>{{@model.fullName}}</strong>
        <span class='role'>{{@model.role}}</span>
      </div>
      <style scoped>
        .staff-row {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-xs);
        }
        .role {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
