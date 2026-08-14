import CalendarCheckIcon from '@cardstack/boxel-icons/calendar-check';

import { statusField } from './status-field';

/**
 * Where someone stands on attending something — the answer to an invitation,
 * not the payment for it and not the turnstile scan.
 *
 * RSVP is intent, so nothing here is terminal: people change their minds up to
 * the doors opening, and a Declined that could never become a Going would just
 * push consumers into deleting and recreating records. The graph instead
 * encodes the one move that IS illegal: nobody returns to Invited — an answer,
 * once given, can change but not un-happen.
 *
 * Built on `statusField`, so the option set renders as constrained dropdowns
 * and state pills for free, and consumers can call its `nextStatuses` /
 * `canTransition` helpers against this class. Consumers with a different
 * vocabulary (a wedding's "Attending with guest") build their own via
 * `statusField`; this export is the common five-answer form.
 */
export const RsvpStatusField = statusField({
  displayName: 'RSVP Status',
  icon: CalendarCheckIcon,
  options: [
    {
      value: 'Invited',
      hue: 'slate',
      meaning: 'Asked, no answer yet',
    },
    {
      value: 'Going',
      hue: 'green',
      meaning: 'Confirmed they will attend',
    },
    {
      value: 'Maybe',
      hue: 'amber',
      meaning: 'Interested but not committed',
    },
    {
      value: 'Waitlisted',
      hue: 'purple',
      meaning: 'Wants to attend; no place for them yet',
    },
    {
      value: 'Declined',
      hue: 'red',
      meaning: 'Said no — can still change their mind',
    },
  ],
  transitions: {
    Invited: ['Going', 'Maybe', 'Waitlisted', 'Declined'],
    Going: ['Maybe', 'Declined'],
    Maybe: ['Going', 'Waitlisted', 'Declined'],
    Waitlisted: ['Going', 'Declined'],
    Declined: ['Going', 'Maybe'],
  },
});

export default RsvpStatusField;
