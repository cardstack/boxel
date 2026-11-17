import PowerCalendarService from '@cardstack/boxel-ui/components/date-range-picker/power-calendar-service';

import { nowDate } from '@cardstack/runtime-common';

// The calendars' "today" comes from the clock seam, like every other rendered
// time in the host (ADR 023 §1.6).
export default class HostPowerCalendarService extends PowerCalendarService {
  getDate() {
    return this.date || nowDate();
  }
}
