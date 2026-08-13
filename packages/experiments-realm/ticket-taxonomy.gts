import { StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import SirenIcon from '@cardstack/boxel-icons/siren';
import GaugeIcon from '@cardstack/boxel-icons/gauge';
import InboxIcon from '@cardstack/boxel-icons/inbox';
import TicketIcon from '@cardstack/boxel-icons/ticket';

import { statusField, statusOption, canTransition } from './status-field';
import { priorityField, priorityRank, priorityFactor } from './priority-field';

// ServiceDesk's vocabulary, built ON the generic Status and Priority blocks
// rather than beside them. Everything specific to support lives here; anything
// another domain would also want lives one layer down.
//
// This module is separate from ticket.gts because SLA policies, queues and
// categories all need to talk about priority, and they are themselves linked
// FROM the ticket — co-locating would make the import graph circular.

// --------------------------------------------------------------------------
// Status
// --------------------------------------------------------------------------

/**
 * `holds: true` marks the statuses where the SLA clock stops.
 *
 * Pending and On Hold stop it because the ball is in someone else's court —
 * time spent waiting for the customer is not time we made them wait. Resolved
 * and Closed stop it because there is nothing left to measure.
 */
export const TicketStatusField = statusField({
  displayName: 'Ticket Status',
  icon: TicketIcon,
  // Every option carries its `meaning`. The workspace renders these as menu
  // subtitles where the move is chosen, which is the one moment the
  // distinction matters — Pending and On Hold both read as "waiting", and the
  // difference (who you are waiting on) decides which one is honest.
  //
  // Full sentences: they are rendered in a hover popover the workspace owns,
  // so nothing title-cases them. (They were briefly written as phrases to
  // survive boxel-ui's menu item, which capitalises every word through CSS a
  // card's `<style scoped>` cannot reach — the menu renders through the
  // dropdown's portal, outside the template's scope. Hand-rolling the menu
  // rows removed that constraint.)
  options: [
    {
      value: 'New',
      hue: 'blue',
      meaning: 'Raised but not yet picked up. The clock is already running.',
    },
    {
      value: 'Open',
      hue: 'teal',
      meaning: 'Somebody is working it right now. The clock is running.',
    },
    {
      value: 'Pending',
      label: 'Pending customer',
      hue: 'amber',
      holds: true,
      meaning:
        'Waiting on the customer to reply. The clock is paused — time they take is not time we made them wait.',
    },
    {
      value: 'On Hold',
      hue: 'slate',
      holds: true,
      meaning:
        'Waiting on someone outside support — a vendor, another team. The clock is paused.',
    },
    {
      value: 'Resolved',
      hue: 'green',
      holds: true,
      meaning: 'Answered. It stays visible for the day in case they come back.',
    },
    {
      value: 'Closed',
      hue: 'slate',
      terminal: true,
      holds: true,
      meaning: 'Finished and filed. Re-opening it is a deliberate act.',
    },
    {
      value: 'Cancelled',
      hue: 'slate',
      terminal: true,
      holds: true,
      meaning:
        'Not real work — a duplicate, a test, a mistake. It is not counted in any report.',
    },
  ],
  // No edge from New to Closed. A ticket that was never worked but counts as
  // handled quietly inflates every report built on top of it.
  transitions: {
    New: ['Open', 'Pending', 'On Hold', 'Resolved', 'Cancelled'],
    Open: ['Pending', 'On Hold', 'Resolved', 'Cancelled'],
    Pending: ['Open', 'On Hold', 'Resolved', 'Cancelled'],
    'On Hold': ['Open', 'Pending', 'Resolved', 'Cancelled'],
    Resolved: ['Closed', 'Open'],
    Closed: ['Open'],
    Cancelled: ['Open'],
  },
});

export const TICKET_STATUSES = TicketStatusField.statusOptions.map(
  (o) => o.value,
);

export function statusPausesSla(status?: string | null): boolean {
  return statusOption(TicketStatusField, status)?.holds ?? false;
}

export function statusIsTerminal(status?: string | null): boolean {
  return statusOption(TicketStatusField, status)?.terminal ?? false;
}

export function canTransitionTicket(from?: string | null, to?: string | null) {
  return canTransition(TicketStatusField, from, to);
}

// --------------------------------------------------------------------------
// Priority
// --------------------------------------------------------------------------

// `factor` scales a policy's base target: a P1 gets a quarter of the standard
// time, a P4 gets double. Keeping the multiplier on the option means a policy
// only has to state one target per metric instead of four.
export const TicketPriorityField = priorityField({
  displayName: 'Priority',
  icon: SirenIcon,
  shortAtom: true,
  options: [
    {
      value: 'P1',
      label: 'P1 · Critical',
      hue: 'red',
      factor: 0.25,
      meaning:
        'Work has stopped for everyone and there is no way around it. Answer now, whatever else is open.',
    },
    {
      value: 'P2',
      label: 'P2 · High',
      hue: 'orange',
      factor: 0.5,
      meaning:
        'A team is badly slowed, or one person is fully blocked with no workaround.',
    },
    {
      value: 'P3',
      label: 'P3 · Medium',
      hue: 'amber',
      factor: 1,
      meaning:
        'Something is broken but there is a way round it. The standard promise applies.',
    },
    {
      value: 'P4',
      label: 'P4 · Low',
      hue: 'slate',
      factor: 2,
      meaning:
        'A question or a request with no deadline attached — laptops, access, how-do-I.',
    },
  ],
});

export const TICKET_PRIORITIES = TicketPriorityField.priorityOptions.map(
  (o) => o.value,
);

export function ticketPriorityRank(priority?: string | null): number {
  return priorityRank(TicketPriorityField, priority);
}

export function ticketPriorityFactor(priority?: string | null): number {
  return priorityFactor(TicketPriorityField, priority);
}

// --------------------------------------------------------------------------
// Channel
// --------------------------------------------------------------------------

export const TICKET_CHANNELS = [
  'Email',
  'Chat',
  'Phone',
  'Portal',
  'Social',
] as const;

export const TicketChannelField = enumField(StringField, {
  displayName: 'Channel',
  icon: InboxIcon,
  options: TICKET_CHANNELS as unknown as string[],
});

// --------------------------------------------------------------------------
// Type — the ITIL distinction, kept as a field as well as a subclass
// --------------------------------------------------------------------------

// Incident and ServiceRequest are real subclasses, but a subclass name is not
// readable in a prerendered tile (which resolves nothing) or sortable in a
// queue. Each subclass computes this field to a constant, so the display and
// the type agree by construction rather than by discipline.
export const TICKET_TYPES = ['Incident', 'Service Request'] as const;

export const TicketTypeField = enumField(StringField, {
  displayName: 'Ticket Type',
  icon: GaugeIcon,
  options: TICKET_TYPES as unknown as string[],
});

// --------------------------------------------------------------------------
// Impact and urgency — Incident only
// --------------------------------------------------------------------------

export const IMPACT_LEVELS = [
  'Organization',
  'Department',
  'Team',
  'Individual',
] as const;

export const URGENCY_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const;

export const ImpactField = enumField(StringField, {
  displayName: 'Impact',
  options: IMPACT_LEVELS as unknown as string[],
});

export const UrgencyField = enumField(StringField, {
  displayName: 'Urgency',
  options: URGENCY_LEVELS as unknown as string[],
});

/**
 * The ITIL impact × urgency grid, collapsed to a suggested priority.
 *
 * Suggested, not enforced: an agent who knows the customer is on a call with
 * the CEO overrides it, and the override is the point — the grid exists to
 * stop everything from being filed as P1, not to take the decision away.
 */
export function suggestedPriority(
  impact?: string | null,
  urgency?: string | null,
): string | undefined {
  let i = IMPACT_LEVELS.indexOf(impact as never);
  let u = URGENCY_LEVELS.indexOf(urgency as never);
  if (i === -1 || u === -1) {
    return undefined;
  }
  let score = i + u;
  return score <= 1 ? 'P1' : score <= 3 ? 'P2' : score <= 4 ? 'P3' : 'P4';
}
