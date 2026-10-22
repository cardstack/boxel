// Pretui — PeriodInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PERIOD_FORMS, PeriodInput, parsePeriod, periodRangeText } from './period-input';
import type { Period, PeriodResult } from './period-input';

const LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP'];
const FISCAL_STARTS = ['1', '4', '7', '10'];
const FISCAL_LABELS = ['start', 'end'];
const HEMISPHERES = ['north', 'south'];

interface SpecimenRow {
  typed: string;
  kind: string;
  id: string;
  range: string;
  days: string;
}

class PeriodInputUsage extends Component {
  @tracked reference = '2026-08-13';
  @tracked locale = 'en-US';
  @tracked fiscalYearStart = '1';
  @tracked fiscalYearLabel: 'start' | 'end' = 'start';
  @tracked hemisphere: 'north' | 'south' = 'north';
  @tracked seed = 'Q3 2026';
  @tracked hint = 'Q3 2026';
  @tracked label = 'Reporting period';
  @tracked noStep = false;
  @tracked quiet = false;
  @tracked emitted = 'Nothing emitted yet.';

  localeOptions = LOCALES;
  fiscalStartOptions = FISCAL_STARTS;
  fiscalLabelOptions = FISCAL_LABELS;
  hemisphereOptions = HEMISPHERES;

  setReference = (v: string) => (this.reference = v);
  setLocale = (v: string) => (this.locale = v);
  setFiscalStart = (v: string) => (this.fiscalYearStart = v);
  setFiscalLabel = (v: string) => (this.fiscalYearLabel = v as 'start' | 'end');
  setHemisphere = (v: string) => (this.hemisphere = v as 'north' | 'south');
  setSeed = (v: string) => (this.seed = v);
  setHint = (v: string) => (this.hint = v);
  setLabel = (v: string) => (this.label = v);
  setNoStep = (v: boolean) => (this.noStep = v);
  setQuiet = (v: boolean) => (this.quiet = v);

  take = (period: Period | undefined, result: PeriodResult) => {
    if (period) {
      this.emitted =
        'onChange with ' + period.id + ' — ' + period.start + ' to ' + period.end;
    } else if (result.empty) {
      this.emitted = 'onChange with undefined — the box is empty.';
    } else {
      this.emitted = 'onChange with undefined — ' + (result.issue ?? '');
    }
  };

  get fiscalStartNumber(): number {
    return Number(this.fiscalYearStart);
  }

  get options() {
    return {
      reference: this.reference,
      locale: this.locale,
      fiscalYearStart: this.fiscalStartNumber,
      fiscalYearLabel: this.fiscalYearLabel,
      hemisphere: this.hemisphere,
    };
  }

  /** Every documented form, resolved under the current conventions. */
  get specimens(): SpecimenRow[] {
    let forms = PERIOD_FORMS.concat(['Q3', 'Winter 2026']);
    return forms.map((typed) => {
      let result = parsePeriod(typed, this.options);
      let period = result.period;
      return {
        typed,
        kind: period ? period.kind : '—',
        id: period ? period.id : '—',
        range: period
          ? periodRangeText(period, this.locale)
          : (result.issue ?? ''),
        days: period ? String(period.days) : '',
      };
    });
  }

  get usage(): string {
    return (
      '<PeriodInput' +
      " @reference='" +
      this.reference +
      "'" +
      " @fiscalYearStart=" +
      '{{' +
      this.fiscalYearStart +
      '}}' +
      ' @onChange={{this.take}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='PeriodInput'
      @description='Type Q3, Jan 2026, W12 or Summer 2025 and get a typed period back — a kind, a year, an inclusive date range and a key that sorts. Not a date picker and not a duration: a period is a NAME for a span of the calendar that a reader already knows. Every convention that has no universal answer is a knob, including the one that matters most: with no reference instant, a partial period is refused rather than resolved against the wall clock.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-perioddemo'>
          <PeriodInput
            @defaultValue={{this.seed}}
            @reference={{this.reference}}
            @locale={{this.locale}}
            @fiscalYearStart={{this.fiscalStartNumber}}
            @fiscalYearLabel={{this.fiscalYearLabel}}
            @hemisphere={{this.hemisphere}}
            @label={{this.label}}
            @hint={{this.hint}}
            @noStep={{this.noStep}}
            @quiet={{this.quiet}}
            @onChange={{this.take}}
          />
          <p class='pretui-perioddemo-note'>{{this.emitted}}</p>

          <p class='pretui-perioddemo-cap'>Every form, under the current
            conventions</p>
          <ul class='pretui-perioddemo-table'>
            {{#each this.specimens key='typed' as |row|}}
              <li class='pretui-perioddemo-row'>
                <span class='pretui-perioddemo-typed'>{{row.typed}}</span>
                <span class='pretui-perioddemo-kind'>{{row.kind}}</span>
                <span class='pretui-perioddemo-id'>{{row.id}}</span>
                <span class='pretui-perioddemo-range'>{{row.range}}</span>
                <span class='pretui-perioddemo-days'>{{row.days}}</span>
              </li>
            {{/each}}
          </ul>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='reference'
          @value={{this.reference}}
          @description='The instant a partial period like Q3 resolves against. Clear it and every partial form in the table below turns into a request for a year — which is the honest behaviour, because nothing here reads the clock and a card that guessed would index differently every time.'
          @onInput={{this.setReference}}
        />
        <Args.String
          @name='fiscalYearStart'
          @value={{this.fiscalYearStart}}
          @options={{this.fiscalStartOptions}}
          @defaultValue='1'
          @description='The calendar month a fiscal year starts in. 1 is the calendar year. Move it to 7 and Q1 becomes July to September.'
          @onInput={{this.setFiscalStart}}
        />
        <Args.String
          @name='fiscalYearLabel'
          @value={{this.fiscalYearLabel}}
          @options={{this.fiscalLabelOptions}}
          @defaultValue='start'
          @description='Whether a fiscal year is named for the calendar year it starts in or the one it ends in. There is genuinely no universal answer, so it is a knob rather than an assumption. Irrelevant while fiscalYearStart is 1.'
          @onInput={{this.setFiscalLabel}}
        />
        <Args.String
          @name='hemisphere'
          @value={{this.hemisphere}}
          @options={{this.hemisphereOptions}}
          @defaultValue='north'
          @description='Which hemisphere the season names describe. These are the meteorological seasons — three whole months each, no gaps and no overlaps, which is what makes a season a period at all.'
          @onInput={{this.setHemisphere}}
        />
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @options={{this.localeOptions}}
          @defaultValue='en-US'
          @description='Decides which month names are understood and how the resolved range is written. English month names are always accepted as well, so a reader typing Mar into a German form is never told off.'
          @onInput={{this.setLocale}}
        />
        <Args.String
          @name='defaultValue'
          @value={{this.seed}}
          @description='The initial text. A resolved period is normalised on commit, so q3 2026 becomes Q3 2026 and the reader can see it was understood.'
          @onInput={{this.setSeed}}
        />
        <Args.String
          @name='hint'
          @value={{this.hint}}
          @description='Ghost text behind an empty box. Not a placeholder attribute — a placeholder doubles as the accessible name and vanishes on the first keystroke.'
          @onInput={{this.setHint}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Period'
          @description='The accessible name, ignored when a Field wrapper supplied a controlId.'
          @onInput={{this.setLabel}}
        />
        <Args.Bool
          @name='noStep'
          @value={{this.noStep}}
          @defaultValue={{false}}
          @description='Hide the previous / next stepper. It moves the period by one of its OWN kind, so the next quarter after Q4 is Q1 of the following year and the next week after week 53 depends on how many weeks the year has. Up and down arrows do the same from the keyboard.'
          @onInput={{this.setNoStep}}
        />
        <Args.Bool
          @name='quiet'
          @value={{this.quiet}}
          @defaultValue={{false}}
          @description='Hide the accepted-forms line. The resolved-range row is reserved space either way.'
          @onInput={{this.setQuiet}}
        />
        <Args.Base
          @name='Period'
          @typeLabel='Interface'
          @description='kind, id, year, index, start, end, days, label, and sortKey. The id sorts within a kind; sortKey is the start date and sorts across kinds, which an id cannot.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Fires on every keystroke with the resolved period, or undefined and the reason there is not one. The reason is computed immediately and only SHOWN after a commit, because telling a reader that Ja is not a month while they are typing January is how a parsing input becomes unusable.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-perioddemo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 560px;
      }
      .pretui-perioddemo-note {
        margin: 0;
        min-height: 1.4em;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-perioddemo-cap {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-xs, 10.5px);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-perioddemo-table {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 1px;
      }
      .pretui-perioddemo-row {
        display: grid;
        grid-template-columns: 6.5rem 4rem 5.5rem 1fr 2.5rem;
        align-items: baseline;
        gap: var(--space-2, 6px);
        padding: 3px 0;
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
      }
      .pretui-perioddemo-typed {
        font-family: var(--font-mono);
        color: var(--foreground);
      }
      .pretui-perioddemo-kind,
      .pretui-perioddemo-id {
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }
      .pretui-perioddemo-range {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--foreground);
      }
      .pretui-perioddemo-days {
        text-align: end;
        color: var(--muted-foreground);
      }
      @container (max-width: 420px) {
        .pretui-perioddemo-row {
          grid-template-columns: 1fr 1fr;
        }
      }
    </style>
  </template>
}

export const DEMOS_PERIOD_INPUT: Record<string, unknown> = {
  PeriodInput: PeriodInputUsage,
};
