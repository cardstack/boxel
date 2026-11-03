// A message's moment, as the message list shows it: the short time on the
// message, the full date in the tooltip on that time.
const SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
});

export function shortTime(timestamp: Date): string {
  return SHORT_TIME.format(timestamp);
}

export function fullDate(timestamp: Date): string {
  return FULL_DATE.format(timestamp);
}
