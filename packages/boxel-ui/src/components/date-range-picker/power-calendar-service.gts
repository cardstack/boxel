// ember-power-calendar reads "today" (the day it opens on, and the today
// marker on a day cell) from this service's `getDate()`. An app that reads the
// current time from a clock of its own subclasses it as its own
// `service:power-calendar`, so the calendars agree with that clock.
export { default } from 'ember-power-calendar/services/power-calendar';
