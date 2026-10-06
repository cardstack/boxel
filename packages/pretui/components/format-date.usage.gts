// Pretui — FormatDate usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FormatDate } from './format-date';
import { LOCALES, SPOKEN_MODES } from '../demo-reading-format';

// ── FormatDate ───────────────────────────────────────────────────────────
const DATE_STYLES = ['', 'full', 'long', 'medium', 'short'];

const ZONES = ['UTC', 'Asia/Shanghai', 'Europe/Lisbon', 'America/Sao_Paulo'];

// The clock is NOT read here. @now is caller-supplied exactly as
// RelativeTime takes it (realm law: no Date.now() in realm code), which is
// also why @omitCurrentYear is inert until @now is passed — the component
// has no other way to know what "this year" means.
class FormatDateUsage extends Component {
  styleOptions = DATE_STYLES;
  localeOptions = LOCALES;
  zoneOptions = ZONES;
  spokenOptions = SPOKEN_MODES;

  @tracked date = '2026-05-23T09:41:00Z';
  @tracked locale = 'en-US';
  @tracked dateStyle = 'medium';
  @tracked timeStyle = '';
  @tracked timeZone = 'UTC';
  @tracked token = false;
  @tracked hint = true;
  @tracked spoken = 'auto';

  setDate = (v: string) => (this.date = v);
  setLocale = (v: string) => (this.locale = v);
  setDateStyle = (v: string) => (this.dateStyle = v);
  setTimeStyle = (v: string) => (this.timeStyle = v);
  setTimeZone = (v: string) => (this.timeZone = v);
  setToken = (v: boolean) => (this.token = v);
  setHint = (v: boolean) => (this.hint = v);
  setSpoken = (v: string) => (this.spoken = v);

  get dateStyleVal() {
    return (this.dateStyle || undefined) as
      | 'full'
      | 'long'
      | 'medium'
      | 'short'
      | undefined;
  }
  get timeStyleVal() {
    return (this.timeStyle || undefined) as
      | 'full'
      | 'long'
      | 'medium'
      | 'short'
      | undefined;
  }
  get spokenVal() {
    return this.spoken as 'auto' | 'always' | 'off';
  }
  get usage() {
    let bits = [`@date='${this.date}'`];
    if (this.dateStyle) bits.push(`@dateStyle='${this.dateStyle}'`);
    if (this.timeStyle) bits.push(`@timeStyle='${this.timeStyle}'`);
    if (this.locale !== 'en-US') bits.push(`@locale='${this.locale}'`);
    if (this.timeZone !== 'UTC') bits.push(`@timeZone='${this.timeZone}'`);
    if (this.token) bits.push('@token={{true}}');
    if (!this.hint) bits.push('@hint={{false}}');
    if (this.spoken !== 'auto') bits.push(`@spoken='${this.spoken}'`);
    return `<FormatDate ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='FormatDate'
      @description="Locale-aware dates and times over Intl.DateTimeFormat, rendered inside a real <time datetime> element so the machine-readable instant survives alongside the human one. Presets (@dateStyle/@timeStyle) and component knobs (@year, @month, @weekday…) are mutually exclusive in Intl, so precedence is resolved here instead of throwing. Takes @now as an argument and never reads the clock. Sibling of RelativeTime, which measures distance rather than stating a moment."
      @source={{this.usage}}
    >
      <:example>
        <div class='fmt-stack'>
          <p class='fmt-line'>
            The
            <em>Silver Needle</em>
            lot from Fuding cleared inspection on
            <FormatDate
              @date={{this.date}}
              @locale={{this.locale}}
              @dateStyle={{this.dateStyleVal}}
              @timeStyle={{this.timeStyleVal}}
              @timeZone={{this.timeZone}}
              @token={{this.token}}
              @hint={{this.hint}}
              @spoken={{this.spokenVal}}
            />.
          </p>

          <div class='fmt-grid'>
            {{#each this.localeOptions as |loc|}}
              <div class='fmt-cell'>
                <span class='fmt-cap'>{{loc}}</span>
                <FormatDate
                  @date={{this.date}}
                  @locale={{loc}}
                  @dateStyle={{this.dateStyleVal}}
                  @timeStyle={{this.timeStyleVal}}
                  @timeZone={{this.timeZone}}
                />
              </div>
            {{/each}}
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='date'
          @value={{this.date}}
          @description='A Date, an epoch number, or a string. A bare YYYY-MM-DD is read as a LOCAL calendar date, not UTC midnight — the off-by-one-day trap.'
          @onInput={{this.setDate}}
        />
        <Args.String
          @name='dateStyle'
          @value={{this.dateStyle}}
          @options={{this.styleOptions}}
          @description='Whole-date preset. Ignored the moment any component knob is set, because Intl refuses the combination.'
          @onInput={{this.setDateStyle}}
        />
        <Args.String
          @name='timeStyle'
          @value={{this.timeStyle}}
          @options={{this.styleOptions}}
          @description='Whole-time preset, same precedence rule as @dateStyle. Empty renders a date with no time.'
          @onInput={{this.setTimeStyle}}
        />
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @options={{this.localeOptions}}
          @description='BCP-47 tag; omit for the runtime default. An unknown tag falls back rather than throwing.'
          @onInput={{this.setLocale}}
        />
        <Args.String
          @name='timeZone'
          @value={{this.timeZone}}
          @options={{this.zoneOptions}}
          @description='IANA zone. An unknown zone falls back to local rather than throwing.'
          @onInput={{this.setTimeZone}}
        />
        <Args.Bool
          @name='hint'
          @defaultValue={{true}}
          @value={{this.hint}}
          @description='Carry the long form in a title attribute. A caller-supplied title in ...attributes wins.'
          @onInput={{this.setHint}}
        />
        <Args.Bool
          @name='token'
          @defaultValue={{false}}
          @value={{this.token}}
          @description='Wear the Token dress (Law 3) — for log lines and machine contexts.'
          @onInput={{this.setToken}}
        />
        <Args.String
          @name='spoken'
          @defaultValue='auto'
          @value={{this.spoken}}
          @options={{this.spokenOptions}}
          @description="sr-only mirror policy. auto mirrors when the visible form is numeric-heavy — '3/14/26' reads badly aloud."
          @onInput={{this.setSpoken}}
        />
        <Args.String
          @name='now'
          @description='Reference instant for @omitCurrentYear, caller-supplied exactly as RelativeTime takes it. This component never reads the clock (realm law: no Date.now()).'
        />
        <Args.Bool
          @name='omitCurrentYear'
          @defaultValue={{false}}
          @description='Drop the year when the date falls in the same year as @now. Inert without @now — there is no other way to know what this year is.'
        />
        <Args.String
          @name='weekday, era, year, month, day, hour, minute, second, timeZoneName'
          @description='Individual Intl components. Setting any one of them overrides @dateStyle/@timeStyle entirely.'
        />
        <Args.String
          @name='hour12, hourCycle, calendar, numberingSystem'
          @description='Clock, calendar system (e.g. japanese), and digit system (e.g. arab).'
        />
        <Args.Object
          @name='options'
          @description='Escape hatch for any Intl.DateTimeFormat option not named above. Named knobs win over it.'
        />
        <Args.String
          @name='placeholder'
          @defaultValue='—'
          @description='Rendered when the date is missing or unparseable. Never emits Invalid Date.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .fmt-stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-4, 14px);
      }
      .fmt-line {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.6;
        color: var(--foreground);
      }
      .fmt-line em {
        font-style: normal;
        font-weight: 600;
      }
      .fmt-cap {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .fmt-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--space-3, 10px);
      }
      .fmt-cell {
        display: flex;
        flex-direction: column;
        gap: var(--space-1, 4px);
        padding: var(--space-3, 10px);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_FORMAT_DATE: Record<string, unknown> = {
  FormatDate: FormatDateUsage,
};
