import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';
import StringField from 'https://cardstack.com/base/string';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

export class DateTimeTest extends CardDef {
  static displayName = 'DateTime Format Test';

  @field testDate = contains(DatetimeField);
  @field testDescription = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: DateTimeTest) {
      return this.testDescription || 'DateTime Test';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // Helper getters for relative time testing
    get getTwoHoursAgo() {
      const now = new Date();
      return new Date(now.getTime() - 2 * 60 * 60 * 1000);
    }

    get getYesterday() {
      const now = new Date();
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    get getThreeDaysAgo() {
      const now = new Date();
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    }

    get getLastWeek() {
      const now = new Date();
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    get getLastMonth() {
      const now = new Date();
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    get getTwoHoursLater() {
      const now = new Date();
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    }

    get getTomorrow() {
      const now = new Date();
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    get getNextWeek() {
      const now = new Date();
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    get getFifteenSecondsAgo() {
      const now = new Date();
      return new Date(now.getTime() - 15 * 1000);
    }

    get getFortyFiveSecondsAgo() {
      const now = new Date();
      return new Date(now.getTime() - 45 * 1000);
    }

    get getFiveMinutesAgo() {
      const now = new Date();
      return new Date(now.getTime() - 5 * 60 * 1000);
    }

    get getFortyFiveMinutesAgo() {
      const now = new Date();
      return new Date(now.getTime() - 45 * 60 * 1000);
    }

    get getTwoWeeksAgo() {
      const now = new Date();
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    }

    get getTwoMonthsAgo() {
      const now = new Date();
      return new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    }

    get getOneYearAgo() {
      const now = new Date();
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    // For precision testing
    get getTwoMonthsFifteenDaysAgo() {
      const now = new Date();
      return new Date(now.getTime() - (60 + 15) * 24 * 60 * 60 * 1000);
    }

    get getOneYearTwoMonthsAgo() {
      const now = new Date();
      return new Date(now.getTime() - (365 + 60) * 24 * 60 * 60 * 1000);
    }

    get getThreeDaysFourHoursAgo() {
      const now = new Date();
      return new Date(
        now.getTime() - (3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      );
    }

    get getTwoDaysTenHoursThirtyMinutesAgo() {
      const now = new Date();
      return new Date(
        now.getTime() -
          (2 * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000 + 30 * 60 * 1000),
      );
    }

    <template>
      <div class='datetime-test'>
        <header class='test-header'>
          <h1>DateTime Helper Comprehensive Test</h1>
          <div class='current-value'>
            Test Date:
            {{String @model.testDate}}
          </div>
        </header>

        {{#if @model.testDate}}
          <div class='test-sections'>

            <!-- Size/Preset Variants -->
            <section class='test-section'>
              <h2>Size/Preset Variants</h2>
              <div class='test-grid'>
                <table class='test-table'>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Parameters</th>
                      <th>Output</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class='test-name'>Tiny</td>
                      <td><code class='test-params'>preset='tiny'</code></td>
                      <td><code class='test-output'>{{formatDateTime
                            @model.testDate
                            preset='tiny'
                          }}</code></td>
                      <td class='test-note'>Time if today, else date</td>
                    </tr>
                    <tr>
                      <td class='test-name'>Short</td>
                      <td><code class='test-params'>preset='short'</code></td>
                      <td><code class='test-output'>{{formatDateTime
                            @model.testDate
                            preset='short'
                          }}</code></td>
                      <td class='test-note'>Abbreviated</td>
                    </tr>
                    <tr>
                      <td class='test-name'>Medium</td>
                      <td><code class='test-params'>preset='medium'</code></td>
                      <td><code class='test-output'>{{formatDateTime
                            @model.testDate
                            preset='medium'
                          }}</code></td>
                      <td class='test-note'>Standard</td>
                    </tr>
                    <tr>
                      <td class='test-name'>Long</td>
                      <td><code class='test-params'>preset='long'</code></td>
                      <td><code class='test-output'>{{formatDateTime
                            @model.testDate
                            preset='long'
                          }}</code></td>
                      <td class='test-note'>Full with day name</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Kind Variants -->
            <section class='test-section'>
              <h2>Kind Variants</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Date only</td>
                    <td><code class='test-params'>kind='date'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='date'
                        }}</code></td>
                    <td class='test-note'>ISO date format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Time only</td>
                    <td><code class='test-params'>kind='time'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='time'
                        }}</code></td>
                    <td class='test-note'>HH:MM format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>DateTime</td>
                    <td><code class='test-params'>kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>Combined</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Month</td>
                    <td><code class='test-params'>kind='month'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='month'
                        }}</code></td>
                    <td class='test-note'>Month only</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Year</td>
                    <td><code class='test-params'>kind='year'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='year'
                        }}</code></td>
                    <td class='test-note'>Year only</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Month-Year</td>
                    <td><code class='test-params'>kind='monthYear'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='monthYear'
                        }}</code></td>
                    <td class='test-note'>Month & year</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Month-Day</td>
                    <td><code class='test-params'>kind='monthDay'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='monthDay'
                        }}</code></td>
                    <td class='test-note'>Month & day</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Week (ISO)</td>
                    <td><code class='test-params'>kind='week' weekFormat='iso'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='week'
                          weekFormat='iso'
                        }}</code></td>
                    <td class='test-note'>ISO week number</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Week (Label)</td>
                    <td><code class='test-params'>kind='week' weekFormat='label'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='week'
                          weekFormat='label'
                        }}</code></td>
                    <td class='test-note'>Week with text</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Quarter (Qn)</td>
                    <td><code class='test-params'>kind='quarter'
                        quarterFormat='Qn'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='quarter'
                          quarterFormat='Qn'
                        }}</code></td>
                    <td class='test-note'>Q1 2025 format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Quarter (Long)</td>
                    <td><code class='test-params'>kind='quarter'
                        quarterFormat='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='quarter'
                          quarterFormat='long'
                        }}</code></td>
                    <td class='test-note'>Quarter 1, 2025</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Style Combinations -->
            <section class='test-section'>
              <h2>Date & Time Styles</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Date: short</td>
                    <td><code class='test-params'>dateStyle='short'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          dateStyle='short'
                        }}</code></td>
                    <td class='test-note'>Numeric format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Date: medium</td>
                    <td><code class='test-params'>dateStyle='medium'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          dateStyle='medium'
                        }}</code></td>
                    <td class='test-note'>Abbreviated month</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Date: long</td>
                    <td><code class='test-params'>dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>Full month name</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Date: full</td>
                    <td><code class='test-params'>dateStyle='full'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          dateStyle='full'
                        }}</code></td>
                    <td class='test-note'>With day of week</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Time: short</td>
                    <td><code class='test-params'>timeStyle='short'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeStyle='short'
                        }}</code></td>
                    <td class='test-note'>HH:MM</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Time: medium</td>
                    <td><code class='test-params'>timeStyle='medium'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeStyle='medium'
                        }}</code></td>
                    <td class='test-note'>With seconds</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Time: long</td>
                    <td><code class='test-params'>timeStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeStyle='long'
                        }}</code></td>
                    <td class='test-note'>With timezone</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Combined</td>
                    <td><code class='test-params'>dateStyle='long'
                        timeStyle='short'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          dateStyle='long'
                          timeStyle='short'
                        }}</code></td>
                    <td class='test-note'>Date + time</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Custom Format Strings (Day.js) -->
            <section class='test-section'>
              <h2>Custom Format Strings (Day.js)</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Format</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>ISO Date</td>
                    <td><code
                        class='test-params'
                      >format='YYYY-MM-DD'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='YYYY-MM-DD'
                        }}</code></td>
                    <td class='test-note'>Standard ISO</td>
                  </tr>
                  <tr>
                    <td class='test-name'>US Short</td>
                    <td><code class='test-params'>format='MMM D, YYYY'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='MMM D, YYYY'
                        }}</code></td>
                    <td class='test-note'>Abbreviated</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Ordinal Day</td>
                    <td><code class='test-params'>format='MMMM Do, YYYY'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='MMMM Do, YYYY'
                        }}</code></td>
                    <td class='test-note'>1st, 2nd, 3rd</td>
                  </tr>
                  <tr>
                    <td class='test-name'>With Weekday</td>
                    <td><code class='test-params'>format='ddd, MMM D'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='ddd, MMM D'
                        }}</code></td>
                    <td class='test-note'>Mon, Jan 7</td>
                  </tr>
                  <tr>
                    <td class='test-name'>12-Hour Time</td>
                    <td><code class='test-params'>format='h:mm A'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='h:mm A'
                        }}</code></td>
                    <td class='test-note'>AM/PM</td>
                  </tr>
                  <tr>
                    <td class='test-name'>24-Hour Time</td>
                    <td><code class='test-params'>format='HH:mm:ss'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='HH:mm:ss'
                        }}</code></td>
                    <td class='test-note'>With seconds</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Full Custom</td>
                    <td><code class='test-params'>format='dddd, MMMM D, YYYY
                        [at] h:mm A'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          format='dddd, MMMM D, YYYY [at] h:mm A'
                        }}</code></td>
                    <td class='test-note'>Complete format</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Relative Time - Advanced Options -->
            <section class='test-section'>
              <h2>Relative Time - Advanced Options</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>15 seconds ago</td>
                    <td><code class='test-params'>relative=true</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getFifteenSecondsAgo
                          relative=true
                        }}</code></td>
                    <td class='test-note'>Shows "now" or time ago</td>
                  </tr>
                  <tr>
                    <td class='test-name'>45 seconds (threshold)</td>
                    <td><code class='test-params'>relative=true</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getFortyFiveSecondsAgo
                          relative=true
                        }}</code></td>
                    <td class='test-note'>Rounds to "1 minute ago"</td>
                  </tr>
                  <tr>
                    <td class='test-name'>5 minutes ago</td>
                    <td><code class='test-params'>relative=true</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getFiveMinutesAgo
                          relative=true
                        }}</code></td>
                    <td class='test-note'>Shows minutes</td>
                  </tr>
                  <tr>
                    <td class='test-name'>45 minutes (threshold)</td>
                    <td><code class='test-params'>relative=true</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getFortyFiveMinutesAgo
                          relative=true
                        }}</code></td>
                    <td class='test-note'>Rounds to "1 hour ago"</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Multi-Unit Precision -->
            <section class='test-section'>
              <h2>Multi-Unit Precision</h2>
              <p class='section-intro'>Show multiple time units for more precise
                relative times (e.g., "2 months, 15 days ago")</p>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Default: Single unit</td>
                    <td><code class='test-params'>relative=true</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoMonthsFifteenDaysAgo
                          relative=true
                        }}</code></td>
                    <td class='test-note'>Most significant unit only</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Precision: 2 units</td>
                    <td><code class='test-params'>relative=true precision=2</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoMonthsFifteenDaysAgo
                          relative=true
                          precision=2
                        }}</code></td>
                    <td class='test-note'>"2 months, 15 days ago"</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Precision: 3 units</td>
                    <td><code class='test-params'>relative=true precision=3</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoDaysTenHoursThirtyMinutesAgo
                          relative=true
                          precision=3
                        }}</code></td>
                    <td class='test-note'>"2 days, 10 hours, 30 min ago"</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Year + months</td>
                    <td><code class='test-params'>relative=true precision=2</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getOneYearTwoMonthsAgo
                          relative=true
                          precision=2
                        }}</code></td>
                    <td class='test-note'>"1 year, 2 months ago"</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Days + hours</td>
                    <td><code class='test-params'>relative=true precision=2</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getThreeDaysFourHoursAgo
                          relative=true
                          precision=2
                        }}</code></td>
                    <td class='test-note'>"3 days, 4 hours ago"</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Precision + tiny</td>
                    <td><code class='test-params'>relative=true precision=2
                        size='tiny'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getThreeDaysFourHoursAgo
                          relative=true
                          precision=2
                          size='tiny'
                        }}</code></td>
                    <td class='test-note'>Compact multi-unit</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Precision + locale</td>
                    <td><code class='test-params'>relative=true precision=2
                        locale='es-ES'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoMonthsFifteenDaysAgo
                          relative=true
                          precision=2
                          locale='es-ES'
                        }}</code></td>
                    <td class='test-note'>Spanish multi-unit</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Precision + numeric</td>
                    <td><code class='test-params'>relative=true precision=2
                        numeric='always'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoMonthsFifteenDaysAgo
                          relative=true
                          precision=2
                          numeric='always'
                        }}</code></td>
                    <td class='test-note'>Forces numeric</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Future + precision</td>
                    <td><code class='test-params'>relative=true precision=2</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursLater
                          relative=true
                          precision=2
                        }}</code></td>
                    <td class='test-note'>Multi-unit future</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Tiny Preset Scenarios -->
            <section class='test-section'>
              <h2>Tiny Preset Scenarios</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Today (time)</td>
                    <td><code class='test-params'>preset='tiny'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursAgo
                          preset='tiny'
                        }}</code></td>
                    <td class='test-note'>Same day shows time</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Yesterday (date)</td>
                    <td><code class='test-params'>preset='tiny'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getYesterday
                          preset='tiny'
                        }}</code></td>
                    <td class='test-note'>Different day shows date</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Last week</td>
                    <td><code class='test-params'>preset='tiny'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getLastWeek
                          preset='tiny'
                        }}</code></td>
                    <td class='test-note'>Abbreviated date</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Last month</td>
                    <td><code class='test-params'>preset='tiny'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getLastMonth
                          preset='tiny'
                        }}</code></td>
                    <td class='test-note'>Abbreviated date</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + UTC</td>
                    <td><code class='test-params'>preset='tiny' timeZone='UTC'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursAgo
                          preset='tiny'
                          timeZone='UTC'
                        }}</code></td>
                    <td class='test-note'>UTC timezone</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + NY TZ</td>
                    <td><code class='test-params'>preset='tiny'
                        timeZone='America/New_York'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursAgo
                          preset='tiny'
                          timeZone='America/New_York'
                        }}</code></td>
                    <td class='test-note'>NY timezone</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + Tokyo TZ</td>
                    <td><code class='test-params'>preset='tiny'
                        timeZone='Asia/Tokyo'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursAgo
                          preset='tiny'
                          timeZone='Asia/Tokyo'
                        }}</code></td>
                    <td class='test-note'>May differ by day</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + Spanish</td>
                    <td><code class='test-params'>preset='tiny' locale='es-ES'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getYesterday
                          preset='tiny'
                          locale='es-ES'
                        }}</code></td>
                    <td class='test-note'>Spanish format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + Japanese</td>
                    <td><code class='test-params'>preset='tiny' locale='ja-JP'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursAgo
                          preset='tiny'
                          locale='ja-JP'
                        }}</code></td>
                    <td class='test-note'>Japanese format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + Chinese</td>
                    <td><code class='test-params'>preset='tiny' locale='zh-CN'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getLastWeek
                          preset='tiny'
                          locale='zh-CN'
                        }}</code></td>
                    <td class='test-note'>Chinese format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + Arabic</td>
                    <td><code class='test-params'>preset='tiny' locale='ar-SA'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTwoHoursAgo
                          preset='tiny'
                          locale='ar-SA'
                        }}</code></td>
                    <td class='test-note'>Arabic format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tiny + Future</td>
                    <td><code class='test-params'>preset='tiny'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          this.getTomorrow
                          preset='tiny'
                        }}</code></td>
                    <td class='test-note'>Tomorrow shows date</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Hour Formats -->
            <section class='test-section'>
              <h2>Hour Formats</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>12-hour</td>
                    <td><code class='test-params'>kind='time' hour12=true</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='time'
                          hour12=true
                        }}</code></td>
                    <td class='test-note'>AM/PM format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>24-hour</td>
                    <td><code class='test-params'>kind='time' hour12=false</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='time'
                          hour12=false
                        }}</code></td>
                    <td class='test-note'>Military time</td>
                  </tr>
                  <tr>
                    <td class='test-name'>h11 cycle</td>
                    <td><code class='test-params'>kind='time' hourCycle='h11'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='time'
                          hourCycle='h11'
                        }}</code></td>
                    <td class='test-note'>0-11 hours</td>
                  </tr>
                  <tr>
                    <td class='test-name'>h23 cycle</td>
                    <td><code class='test-params'>kind='time' hourCycle='h23'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='time'
                          hourCycle='h23'
                        }}</code></td>
                    <td class='test-note'>0-23 hours</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Month Display Options -->
            <section class='test-section'>
              <h2>Month Display Options</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Numeric</td>
                    <td><code class='test-params'>kind='month'
                        monthDisplay='numeric'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='month'
                          monthDisplay='numeric'
                        }}</code></td>
                    <td class='test-note'>1-12</td>
                  </tr>
                  <tr>
                    <td class='test-name'>2-digit</td>
                    <td><code class='test-params'>kind='month'
                        monthDisplay='2-digit'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='month'
                          monthDisplay='2-digit'
                        }}</code></td>
                    <td class='test-note'>01-12</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Short</td>
                    <td><code class='test-params'>kind='month'
                        monthDisplay='short'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='month'
                          monthDisplay='short'
                        }}</code></td>
                    <td class='test-note'>Jan, Feb, Mar</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Long</td>
                    <td><code class='test-params'>kind='month'
                        monthDisplay='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='month'
                          monthDisplay='long'
                        }}</code></td>
                    <td class='test-note'>January, February</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Narrow</td>
                    <td><code class='test-params'>kind='month'
                        monthDisplay='narrow'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          kind='month'
                          monthDisplay='narrow'
                        }}</code></td>
                    <td class='test-note'>J, F, M (single letter)</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Locale Examples -->
            <section class='test-section'>
              <h2>Different Locales</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>English (US)</td>
                    <td><code class='test-params'>locale='en-US'
                        dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          locale='en-US'
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>Default</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Spanish</td>
                    <td><code class='test-params'>locale='es-ES'
                        dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          locale='es-ES'
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>Spanish format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>French</td>
                    <td><code class='test-params'>locale='fr-FR'
                        dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          locale='fr-FR'
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>French format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>German</td>
                    <td><code class='test-params'>locale='de-DE'
                        dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          locale='de-DE'
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>German format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Japanese</td>
                    <td><code class='test-params'>locale='ja-JP'
                        dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          locale='ja-JP'
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>Japanese format</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Chinese</td>
                    <td><code class='test-params'>locale='zh-CN'
                        dateStyle='long'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          locale='zh-CN'
                          dateStyle='long'
                        }}</code></td>
                    <td class='test-note'>Chinese format</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- TimeZone Examples -->
            <section class='test-section'>
              <h2>Different TimeZones</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>UTC</td>
                    <td><code class='test-params'>timeZone='UTC' kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeZone='UTC'
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>Coordinated Universal Time</td>
                  </tr>
                  <tr>
                    <td class='test-name'>New York</td>
                    <td><code class='test-params'>timeZone='America/New_York'
                        kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeZone='America/New_York'
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>EST/EDT</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Los Angeles</td>
                    <td><code class='test-params'>timeZone='America/Los_Angeles'
                        kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeZone='America/Los_Angeles'
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>PST/PDT</td>
                  </tr>
                  <tr>
                    <td class='test-name'>London</td>
                    <td><code class='test-params'>timeZone='Europe/London'
                        kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeZone='Europe/London'
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>GMT/BST</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Tokyo</td>
                    <td><code class='test-params'>timeZone='Asia/Tokyo'
                        kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeZone='Asia/Tokyo'
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>JST</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Sydney</td>
                    <td><code class='test-params'>timeZone='Australia/Sydney'
                        kind='datetime'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          timeZone='Australia/Sydney'
                          kind='datetime'
                        }}</code></td>
                    <td class='test-note'>AEST/AEDT</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Fallback Handling -->
            <section class='test-section'>
              <h2>Fallback & Edge Cases</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Null with fallback</td>
                    <td><code class='test-params'>fallback='No date set'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          null
                          fallback='No date set'
                        }}</code></td>
                    <td class='test-note'>Shows fallback text</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Undefined</td>
                    <td><code class='test-params'>fallback='N/A'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          undefined
                          fallback='N/A'
                        }}</code></td>
                    <td class='test-note'>Shows fallback text</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Engine Selection -->
            <section class='test-section'>
              <h2>Engine Selection</h2>
              <table class='test-table'>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Parameters</th>
                    <th>Output</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class='test-name'>Auto (default)</td>
                    <td><code class='test-params'>engine='auto'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          engine='auto'
                        }}</code></td>
                    <td class='test-note'>Smart selection</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Force Intl</td>
                    <td><code class='test-params'>engine='intl'
                        dateStyle='medium'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          engine='intl'
                          dateStyle='medium'
                        }}</code></td>
                    <td class='test-note'>Use Intl.DateTimeFormat</td>
                  </tr>
                  <tr>
                    <td class='test-name'>Force Day.js</td>
                    <td><code class='test-params'>engine='dayjs'
                        format='YYYY-MM-DD'</code></td>
                    <td><code class='test-output'>{{formatDateTime
                          @model.testDate
                          engine='dayjs'
                          format='YYYY-MM-DD'
                        }}</code></td>
                    <td class='test-note'>Use Day.js formatting</td>
                  </tr>
                </tbody>
              </table>
            </section>

          </div>
        {{else}}
          <div class='empty-state'>
            <p>Set a test date to see all formatting examples</p>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .datetime-test {
          padding: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .test-header {
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 2px solid #e5e7eb;
        }

        .test-header h1 {
          font-size: 1.875rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          color: #111827;
        }

        .current-value {
          font-size: 0.875rem;
          color: #6b7280;
          font-family: monospace;
        }

        .test-sections {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .test-section {
          background: #f9fafb;
          border-radius: 0.5rem;
          padding: 1.5rem;
        }

        .test-section h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: #374151;
        }

        .section-intro {
          font-size: 0.875rem;
          color: #6b7280;
          margin-bottom: 1rem;
          font-style: italic;
        }

        .test-grid {
          display: block;
        }

        .test-table {
          width: 100%;
          border-collapse: collapse;
          background: white;
          border-radius: 0.5rem;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .test-table thead {
          background: #f3f4f6;
          border-bottom: 2px solid #e5e7eb;
        }

        .test-table th {
          padding: 0.75rem 1rem;
          text-align: left;
          font-size: 0.75rem;
          font-weight: 600;
          color: #374151;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .test-table th:first-child {
          width: 25%;
        }

        .test-table th:nth-child(2) {
          width: 35%;
        }

        .test-table th:nth-child(3) {
          width: 30%;
        }

        .test-table th:last-child {
          width: 10%;
        }

        .test-table tbody tr {
          border-bottom: 1px solid #e5e7eb;
          transition: background-color 0.15s ease;
        }

        .test-table tbody tr:hover {
          background: #f9fafb;
        }

        .test-table tbody tr:last-child {
          border-bottom: none;
        }

        .test-table td {
          padding: 0.75rem 1rem;
          font-size: 0.8125rem;
        }

        .test-name {
          font-weight: 500;
          color: #111827;
        }

        .test-params {
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 0.6875rem;
          color: #6366f1;
          background: #eef2ff;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          display: inline-block;
          max-width: 100%;
          overflow-x: auto;
          white-space: nowrap;
        }

        .test-output {
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 0.75rem;
          color: #059669;
          background: #f0fdf4;
          padding: 0.375rem 0.5rem;
          border-radius: 0.25rem;
          font-weight: 500;
        }

        .test-note {
          font-size: 0.6875rem;
          color: #6b7280;
          font-style: italic;
        }

        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          color: #6b7280;
          font-size: 1.125rem;
        }

        /* Debug Section Styles */
        .debug-section {
          background: #fef3c7;
          border: 2px solid #f59e0b;
        }

        .debug-section h2 {
          color: #92400e;
        }

        .debug-intro {
          font-size: 0.875rem;
          color: #78350f;
          margin-bottom: 1rem;
          font-style: italic;
        }

        .debug-item {
          background: #fffbeb;
          border-color: #fbbf24;
        }

        .debug-output {
          margin-top: 0.5rem;
          padding: 0.75rem;
          background: white;
          border-radius: 0.25rem;
          border: 1px solid #fcd34d;
        }

        .debug-row {
          display: flex;
          gap: 0.5rem;
          align-items: baseline;
          margin-bottom: 0.5rem;
        }

        .debug-row:last-child {
          margin-bottom: 0;
        }

        .debug-label {
          font-weight: 600;
          font-size: 0.75rem;
          color: #92400e;
          min-width: 70px;
        }

        .debug-row code {
          flex: 1;
          margin: 0;
          padding: 0.25rem 0.5rem;
          font-size: 0.75rem;
        }
      </style>
    </template>
  };
}
