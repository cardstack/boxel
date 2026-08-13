import {
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import enumField from '@cardstack/base/enum';
import ListChecksIcon from '@cardstack/boxel-icons/list-checks';

import { Ticket } from './ticket';
import { SupportAgent } from './support-agent';

export const APPROVAL_STATES = [
  'Not required',
  'Pending',
  'Approved',
  'Declined',
] as const;

export const ApprovalStateField = enumField(StringField, {
  displayName: 'Approval',
  options: APPROVAL_STATES as unknown as string[],
});

/**
 * Somebody wants something they are entitled to ask for.
 *
 * The other half of the ITIL split. An incident is measured by how fast
 * service comes back; a request is measured by whether it was fulfilled
 * correctly, and it often has to be approved before any of that starts —
 * which is the whole reason it is a separate class.
 */
export class ServiceRequest extends Ticket {
  static displayName = 'Service Request';
  static icon = ListChecksIcon;

  @field approvalState = contains(ApprovalStateField);
  @field approvedBy = linksTo(() => SupportAgent);
  @field approvedAt = contains(DateTimeField);
  @field fulfilmentNotes = contains(StringField);

  @field ticketType = contains(StringField, {
    computeVia: function (this: ServiceRequest) {
      return 'Service Request';
    },
  });

  @field approverName = contains(StringField, {
    computeVia: function (this: ServiceRequest) {
      return this.approvedBy?.title ?? '';
    },
  });

  /**
   * Whether the request is blocked on somebody's decision.
   *
   * Worth its own field because it changes what the SLA means: time spent
   * waiting for an approver is not time support is failing to respond, and a
   * request that sits in Pending approval with a running resolution clock will
   * breach for reasons nobody in support can do anything about.
   */
  @field awaitingApproval = contains(StringField, {
    computeVia: function (this: ServiceRequest) {
      return this.approvalState === 'Pending' ? 'Awaiting approval' : '';
    },
  });
}
