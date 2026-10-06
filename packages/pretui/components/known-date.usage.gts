// Pretui — KnownDate usage page.
//
// The reference instant is a KNOB, not the clock, which is the point of the
// page as much as of the component: move it and the relative phrase moves
// with it, deterministically, on every render and in every index pass. A
// component that read Date.now() could not have this page at all.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { KnownDate } from './known-date';
import type { KnownDateResult } from './known-date';

export class KnownDateUsage extends Component {
  @tracked label = 'When was the lot harvested?';
  @tracked hint = 'For example, 27 3 2007 — or paste 2007-03-27 into any box';
  @tracked locale = 'en-GB';
  @tracked reference = '2026-08-13';
  @tracked min = '1900-01-01';
  @tracked max = '2099-12-31';
  @tracked seed = '1990-04-15';
  @tracked quiet = false;
  @tracked emitted = 'Nothing emitted yet.';
  @tracked run = 0;

  setLabel = (v: string) => (this.label = v);
  setHint = (v: string) => (this.hint = v);
  setLocale = (v: string) => (this.locale = v);
  setReference = (v: string) => (this.reference = v);
  setMin = (v: string) => (this.min = v);
  setMax = (v: string) => (this.max = v);
  setSeed = (v: string) => (this.seed = v);
  setQuiet = (v: boolean) => (this.quiet = v);

  onChange = (iso: string | undefined, result: KnownDateResult) => {
    if (iso) {
      this.emitted = 'onChange with ' + iso;
    } else if (result.empty) {
      this.emitted = 'onChange with undefined — the boxes are empty.';
    } else {
      this.emitted = 'onChange with undefined — ' + (result.issue ?? '');
    }
  };

  /** KnownDate owns its three boxes after mount (see its signature note), so
   * re-seeding is a re-mount — an identity-keyed single-item list, which is
   * the timer-free replay pattern the motion demos established. */
  reseed = () => (this.run = this.run + 1);
  get runKey(): number[] {
    return [this.run];
  }
  get localeOptions(): string[] {
    return ['en-GB', 'en-US', 'ja-JP', 'de-DE', 'sv-SE'];
  }

  get usage(): string {
    return (
      '<KnownDate @label=' + "'" + this.label + "'" +
      " @locale='" + this.locale + "'" +
      " @reference='" + this.reference + "'" +
      ' @onChange={{this.take}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='KnownDate'
      @description='A date the reader already knows — a birthday, an issue date, an expiry — typed into three boxes rather than browsed in a calendar. Nobody scrolls back forty years to find their own birthday. This is not a second date control: DatePicker and Calendar are for a date you are CHOOSING. Try 3 or mar or March in the month box, 90 in the year box, or paste a whole date into any one of them.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-kd-demo'>
          {{#each this.runKey key='@identity' as |run|}}
            <KnownDate
              @label={{this.label}}
              @hint={{this.hint}}
              @locale={{this.locale}}
              @reference={{this.reference}}
              @value={{this.seed}}
              @min={{this.min}}
              @max={{this.max}}
              @quiet={{this.quiet}}
              @onChange={{this.onChange}}
              data-run={{run}}
            />
          {{/each}}
          <p class='pretui-kd-demo-note'>{{this.emitted}}</p>
          <Button
            @size='xs'
            @appearance='outlined'
            data-test-pretui-known-date-reseed
            {{on 'click' this.reseed}}
          >Re-seed from value</Button>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.seed}}
          @description='The INITIAL date, YYYY-MM-DD. The component owns the three boxes after mount and reports through onChange; re-key it to seed it again.'
          @onInput={{this.setSeed}}
        />
        <Args.String
          @name='reference'
          @value={{this.reference}}
          @description='The instant the relative phrase and two-digit years are measured against. Omit it and no relative phrase is shown — nothing here ever reads the clock, because Date.now would make the card index differently every time.'
          @onInput={{this.setReference}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Date'
          @description='The fieldset legend.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='hint'
          @value={{this.hint}}
          @description='Example copy under the boxes, associated with all three.'
          @onInput={{this.setHint}}
        />
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @defaultValue='en-US'
          @options={{this.localeOptions}}
          @description='Decides the field ORDER and the month vocabulary, asked of Intl rather than kept as a table. Labels stay in the interface language; only the order moves.'
          @onInput={{this.setLocale}}
        />
        <Args.String
          @name='min'
          @value={{this.min}}
          @description='Earliest accepted date, YYYY-MM-DD. Compared as a string, so no time zone can knock the check off by a day.'
          @onInput={{this.setMin}}
        />
        <Args.String
          @name='max'
          @value={{this.max}}
          @description='Latest accepted date, YYYY-MM-DD.'
          @onInput={{this.setMax}}
        />
        <Args.Bool
          @name='quiet'
          @value={{this.quiet}}
          @defaultValue={{false}}
          @description='Suppress the echoed confirmation line. Leave it on: the echo is how a transcription error gets caught before the form is submitted.'
          @onInput={{this.setQuiet}}
        />
        <Args.Action
          @name='onChange'
          @description='Fires on every keystroke with the ISO date, or undefined while the boxes do not yet describe a real date. The second argument carries the reason.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-knowndate-day-width'
          @type='dimension'
          @description='Width of the day box.'
        />
        <Css.Basic
          @name='pretui-knowndate-month-width'
          @type='dimension'
          @description='Width of the month box — wider than the others because it takes names as well as numbers.'
        />
        <Css.Basic
          @name='pretui-knowndate-year-width'
          @type='dimension'
          @description='Width of the year box.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-kd-demo {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
        max-width: 460px;
      }
      .pretui-kd-demo-note {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_KNOWN_DATE: Record<string, unknown> = {
  KnownDate: KnownDateUsage,
};
