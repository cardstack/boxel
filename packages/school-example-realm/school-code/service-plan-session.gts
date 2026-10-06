import CalendarCheckIcon from '@cardstack/boxel-icons/calendar-check';
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import { ServicePlanSchedule } from './service-plan-schedule';

// One delivered session of a service plan. Like the schedule it belongs to, it
// carries its provider's Matrix id. The Education realm's policy has no rule
// for sessions, so only a reader of that realm sees them.
export class ServicePlanSession extends CardDef {
  static displayName = 'Service Plan Session';
  static icon = CalendarCheckIcon;

  @field schedule = linksTo(ServicePlanSchedule);
  @field heldOn = contains(StringField);
  @field summary = contains(StringField);
  @field providerId = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ServicePlanSession) {
      return this.heldOn?.length
        ? `Session on ${this.heldOn}`
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='session-row'>
        <strong>{{@model.heldOn}}</strong>
        <span class='subtle'>{{@model.summary}}</span>
      </div>
      <style scoped>
        .session-row {
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
