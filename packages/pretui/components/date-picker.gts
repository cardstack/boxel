// Pretui — DatePicker: an Input trigger opening a single-date Calendar.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Input } from './input';
import { Popover } from './popover';
import { Calendar } from './calendar';
import { DISPLAY_FMT, fromIso } from '../internal/reading-extras';

// ── DatePicker ───────────────────────────────────────────────────────────
// Single-date input: readonly Pretui Input trigger + Popover around a
// single-mode Calendar (the popover renders its content only while open, so
// the calendar re-derives its view from @value on every open).
export interface DatePickerSignature {
  Args: {
    value?: string; // ISO yyyy-mm-dd (controlled)
    defaultValue?: string; // ISO yyyy-mm-dd (uncontrolled seed)
    disabled?: boolean;
    onValueChange?: (iso: string) => void;
  };
  Element: HTMLSpanElement;
}

export class DatePicker extends Component<DatePickerSignature> {
  @tracked internal: string | undefined = this.args.defaultValue;

  get selectedIso(): string | undefined {
    return this.args.value ?? this.internal;
  }
  get display(): string {
    let iso = this.selectedIso;
    if (!iso) {
      return '';
    }
    let d = fromIso(iso);
    return d ? DISPLAY_FMT.format(d) : iso;
  }
  onTriggerKey = (open: boolean, toggle: () => void, e: Event) => {
    let key = (e as KeyboardEvent).key;
    if (!open && (key === 'Enter' || key === ' ' || key === 'ArrowDown')) {
      e.preventDefault();
      toggle();
    }
  };
  pick = (close: () => void, iso: string) => {
    this.internal = iso;
    this.args.onValueChange?.(iso);
    close();
  };

  <template>
    <span class='pretui-datepicker' data-test-pretui-date-picker ...attributes>
      <Popover @placement='bottom-start' @label='Choose date'>
        <:trigger as |open toggle|>
          <Input
            @value={{this.display}}
            @placeholder='Select date'
            @disabled={{@disabled}}
            class='pretui-datepicker-trigger'
            readonly
            aria-haspopup='dialog'
            aria-expanded={{if open 'true' 'false'}}
            {{on 'click' toggle}}
            {{on 'keydown' (fn this.onTriggerKey open toggle)}}
          />
        </:trigger>
        <:default as |close|>
          <Calendar
            @value={{this.selectedIso}}
            @onValueChange={{fn this.pick close}}
          />
        </:default>
      </Popover>
    </span>
    <style scoped>
      .pretui-datepicker {
        display: inline-block;
      }
      .pretui-datepicker-trigger {
        min-width: 150px;
        cursor: pointer;
      }
      /* the Calendar root is an inline-size container (its width comes from
         the parent), so the panel takes the one-month width explicitly:
         7 × 30px cells + 6 × 2px gaps + panel padding. Sized through
         Popover's own custom-property knobs (they inherit — no :deep()). */
      .pretui-datepicker {
        --pretui-popover-width: calc(222px + 2 * var(--space-4, 11px));
        --pretui-popover-min-width: 0;
      }
    </style>
  </template>
}
