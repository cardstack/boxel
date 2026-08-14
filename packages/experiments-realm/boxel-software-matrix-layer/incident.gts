import { field, contains, StringField } from '@cardstack/base/card-api';
import SirenIcon from '@cardstack/boxel-icons/siren';

import { Ticket } from './ticket';
import {
  ImpactField,
  UrgencyField,
  suggestedPriority,
} from './ticket-taxonomy';

/**
 * Something is broken and service needs restoring.
 *
 * A real subclass rather than a `type` value, so `linksTo(Ticket)` still
 * accepts it while impact and urgency stay off every service request. The
 * `ticketType` field is computed to a constant here, which means the string a
 * tile renders and the class the record actually is can never disagree.
 */
export class Incident extends Ticket {
  static displayName = 'Incident';
  static icon = SirenIcon;

  @field impact = contains(ImpactField);
  @field urgency = contains(UrgencyField);

  @field ticketType = contains(StringField, {
    computeVia: function (this: Incident) {
      return 'Incident';
    },
  });

  /**
   * What the ITIL grid says the priority should be.
   *
   * Computed alongside the real priority rather than into it: an agent who
   * knows the customer is on a call with the CEO must be able to overrule the
   * grid, and seeing both is what makes the override a decision instead of an
   * accident.
   */
  @field suggestedPriority = contains(StringField, {
    computeVia: function (this: Incident) {
      return suggestedPriority(this.impact, this.urgency) ?? '';
    },
  });

  @field priorityIsOverridden = contains(StringField, {
    computeVia: function (this: Incident) {
      let suggested = suggestedPriority(this.impact, this.urgency);
      if (!suggested || !this.priority || suggested === this.priority) {
        return '';
      }
      return `Grid says ${suggested}`;
    },
  });
}
