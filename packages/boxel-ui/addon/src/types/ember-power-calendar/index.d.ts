import DayComponent from 'ember-power-calendar/components/days';
import NavComponent from 'ember-power-calendar/components/nav';

declare module 'ember-power-calendar/components/power-calendar-range' {
  interface PowerCalendarRangeDefaultBlock {
    Days: typeof DayComponent;
    Nav: typeof NavComponent;
  }
}

declare module 'ember-power-calendar' {
  export function registerDateLibrary(dateLibrary: any): void;
}
