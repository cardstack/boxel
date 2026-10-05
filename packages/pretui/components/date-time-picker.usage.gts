// Pretui — DateTimePicker usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { DateTimePicker } from './date-time-picker';

const GRANULARITIES = ['minute', 'second'];

export class DateTimePickerUsage extends Component {
  granularities = GRANULARITIES;
  @tracked value = '2026-10-02T07:30';
  @tracked granularity = 'minute';
  setValue = (v: string) => (this.value = v);
  setGranularity = (v: string) => (this.granularity = v);
  get granularityArg() {
    return this.granularity as 'minute' | 'second';
  }
  get usage() {
    let bits = ['@value={{this.startsAt}}', '@onChange={{this.setStartsAt}}', "@label='Roast starts'"];
    if (this.granularity !== 'minute') bits.push(`@granularity='${this.granularity}'`);
    return `<DateTimePicker ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='DateTimePicker'
      @description='A date and a time in one field with one popover: the calendar and the time segments together, and Done commits a single wall-clock datetime such as 2026-10-02T07:30. Done waits until both halves are set; closing without it keeps the committed value.'
      @source={{this.usage}}
    >
      <:example>
        <div class='dt-demo'>
          <DateTimePicker @value={{this.value}} @onChange={{this.setValue}} @granularity={{this.granularityArg}} @label='Roast starts' />
          <p class='dt-demo-value'>Value: <code>{{this.value}}</code></p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String @name='value' @description="'YYYY-MM-DDTHH:MM', with ':SS' at second granularity. defaultValue seeds the uncontrolled form." />
        <Args.Action @name='onChange' @description='The committed datetime, on Done. onValueChange is an alias.' />
        <Args.String @name='granularity' @value={{this.granularity}} @options={{this.granularities}} @defaultValue='minute' @onInput={{this.setGranularity}} />
        <Args.String @name='hourCycle' @defaultValue='24' />
        <Args.String @name='label' @defaultValue='Date and time' />
        <Args.String @name='placeholder' />
        <Args.String @name='minDate' />
        <Args.String @name='maxDate' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .dt-demo {
        display: grid;
        gap: var(--space-2, 0.375rem);
        padding-block-end: 22rem;
      }
      .dt-demo-value {
        margin: 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_DATE_TIME_PICKER: Record<string, unknown> = {
  DateTimePicker: DateTimePickerUsage,
};
