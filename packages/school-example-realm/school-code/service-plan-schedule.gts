import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { Alert, Button, Pill } from '@cardstack/boxel-ui/components';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  actor,
  operation,
  operations,
  type OperationDeclaration,
} from '@cardstack/base/operations';

import { mirrors, refusalMessage, rosterIds } from './roster-mirror';
import { StaffMember } from './staff-member';

class ScheduleIsolated extends Component<typeof ServicePlanSchedule> {
  @tracked running = false;
  @tracked refusal: string | undefined;

  get schedule(): ServicePlanSchedule {
    return this.args.model as ServicePlanSchedule;
  }

  get canManageRoster(): boolean {
    return this.args.context?.canInvoke?.('update', this.schedule) === true;
  }

  get rosterProviderId(): string | undefined {
    return rosterIds([this.schedule.provider])[0];
  }

  get mirrorIsCurrent(): boolean {
    let linked = this.rosterProviderId;
    return mirrors(
      this.schedule.providerId ? [this.schedule.providerId] : [],
      linked ? [linked] : [],
    );
  }

  // Copies the linked provider's id into the field the policy reads. A realm
  // writer's step; the policy grants no `update` on a schedule.
  @action async syncProviderId() {
    this.refusal = undefined;
    this.running = true;
    try {
      await operations(this.schedule).update({
        attributes: { providerId: this.rosterProviderId ?? null },
      });
    } catch (err) {
      this.refusal = refusalMessage(err);
    } finally {
      this.running = false;
    }
  }

  <template>
    <article class='schedule'>
      <header>
        <h1>{{@model.title}}</h1>
        <p class='subtle'>{{@model.studentName}}
          ·
          {{@model.meets}}</p>
      </header>
      <section>
        <h2>Provider</h2>
        {{#if @model.providerId}}
          <Pill @variant='secondary'>{{@model.providerId}}</Pill>
        {{else}}
          <p class='subtle'>No provider assigned</p>
        {{/if}}
      </section>

      {{#if this.canManageRoster}}
        <section class='admin'>
          <h2>Roster (IT admin)</h2>
          <@fields.provider @format='embedded' />
          {{#if this.mirrorIsCurrent}}
            <p class='subtle'>The provider id matches the roster.</p>
          {{else}}
            <Alert @type='warning' as |Alert|>
              <Alert.Messages
                @messages={{array
                  'The provider id does not match the linked provider, so the policy is deciding on a stale id.'
                }}
              />
            </Alert>
            <Button
              @kind='secondary'
              @disabled={{this.running}}
              {{on 'click' this.syncProviderId}}
            >Sync id from the roster</Button>
          {{/if}}
        </section>
      {{/if}}

      {{#if this.refusal}}
        <Alert @type='error' as |Alert|>
          <Alert.Messages @messages={{array this.refusal}} />
        </Alert>
      {{/if}}
    </article>

    <style scoped>
      .schedule {
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      h1 {
        margin: 0;
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
      }
      h2 {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
      }
      section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        align-items: flex-start;
      }
      .subtle {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .admin {
        padding: var(--boxel-sp);
        border: 1px dashed var(--border, var(--boxel-400));
        border-radius: var(--boxel-border-radius);
        align-self: stretch;
      }
    </style>
  </template>
}

// A student's recurring service — speech therapy, occupational therapy — and
// the provider who delivers it.
//
// `provider` links to the provider's roster card in the Org realm, and
// `providerId` mirrors their Matrix id for the Education realm's policy, which
// can compare `actor()` with a stored string but not with a link.
export class ServicePlanSchedule extends CardDef {
  static displayName = 'Service Plan Schedule';
  static icon = CalendarClockIcon;

  @field title = contains(StringField);
  @field studentName = contains(StringField);
  @field meets = contains(StringField);
  @field provider = linksTo(StaffMember);
  @field providerId = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ServicePlanSchedule) {
      return this.title?.length
        ? this.title
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  // A read, and every row of the listing below, names the linked provider and
  // carries none of the roster card behind the link, which nothing grants a
  // provider.
  @operation static read = {
    base: 'read',
    links: 'ids',
  } satisfies OperationDeclaration;

  // The schedules the caller provides. The declared filter already compares
  // `providerId` with the caller, and for a provider who reads no realm the
  // Education realm's policy adds its own grant's filter on top, in the same
  // SQL query. The realm runs this declaration as it stores it, whatever filter
  // a caller sends under this name.
  @operation static listMySchedules = {
    base: 'query',
    links: 'ids',
    query: {
      filter: {
        on: () => ServicePlanSchedule,
        eq: { providerId: actor() },
      },
      sort: [{ on: () => ServicePlanSchedule, by: 'title', direction: 'asc' }],
    },
  } satisfies OperationDeclaration;

  static isolated = ScheduleIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='schedule-row'>
        <strong>{{@model.title}}</strong>
        <span class='subtle'>{{@model.studentName}} · {{@model.meets}}</span>
      </div>
      <style scoped>
        .schedule-row {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-xs);
        }
        .subtle {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
