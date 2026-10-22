// Pretui — DateTimePicker: a date and a time in one field, committed as one ISO datetime.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { Popover } from './popover';
import { Calendar } from './calendar';
import { TimeInput } from './time-input';
import type { TimeInputHourCycle } from './time-input';
import { Button } from './button';
import { DISPLAY_FMT, fromIso } from '../internal/reading-extras';

export interface DateTimePickerSignature {
  Args: {
    /** Controlled value: 'YYYY-MM-DDTHH:MM', or with ':SS' at second granularity. */
    value?: string;
    defaultValue?: string;
    /** Fires with the committed datetime when Done is pressed. */
    onChange?: (value: string) => void;
    /** Alias of `@onChange` — the kit's control spelling. */
    onValueChange?: (value: string) => void;
    /** 'minute' (default) or 'second'. */
    granularity?: 'minute' | 'second';
    hourCycle?: TimeInputHourCycle;
    /** The trigger's accessible name prefix (default 'Date and time'). */
    label?: string;
    placeholder?: string;
    minDate?: string;
    maxDate?: string;
    disabled?: boolean;
  };
  Element: HTMLSpanElement;
}

const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/;
const MINUTE_TIME = /^\d{2}:\d{2}$/;
const SECOND_TIME = /^\d{2}:\d{2}:\d{2}$/;

function split(value: string | undefined): { date?: string; time?: string } {
  let m = value ? DATETIME.exec(value) : null;
  return m ? { date: m[1], time: m[2] } : {};
}

/**
 * DatePicker and TimeInput composed into one field with one popover: the
 * calendar and the time segments sit together, and Done commits a single
 * string. The value always carries the `T` separator and no zone — a
 * wall-clock datetime, the shape a DateTimeField stores. Done is disabled
 * until both halves are complete, so a half-filled value never leaves the
 * popover; closing without Done keeps the committed value.
 */
export class DateTimePicker extends Component<DateTimePickerSignature> {
  @tracked private internal: string | undefined = this.args.defaultValue;
  @tracked draftDate: string | undefined;
  @tracked draftTime: string | undefined;

  get value(): string | undefined {
    return this.args.value ?? this.internal;
  }
  get withSeconds(): boolean {
    return this.args.granularity === 'second';
  }
  get display(): string {
    let { date, time } = split(this.value);
    if (!date || !time) {
      return '';
    }
    let d = fromIso(date);
    return `${d ? DISPLAY_FMT.format(d) : date}, ${time}`;
  }
  get placeholder(): string {
    return this.args.placeholder ?? 'Select date and time';
  }
  /** Names what the trigger shows, so a voice user can say it (WCAG 2.5.3). */
  get triggerName(): string {
    let label = this.args.label ?? 'Date and time';
    return `${label}: ${this.display || this.placeholder}`;
  }
  /** The time in exactly the shape the granularity commits. */
  get timeShape(): RegExp {
    return this.withSeconds ? SECOND_TIME : MINUTE_TIME;
  }
  get draftComplete(): boolean {
    return Boolean(this.draftDate && this.draftTime && this.timeShape.test(this.draftTime));
  }
  /** A seeded time trimmed or padded to the granularity. */
  private fit(time: string | undefined): string | undefined {
    if (!time) {
      return undefined;
    }
    let hm = time.slice(0, 5);
    return this.withSeconds ? (time.length >= 8 ? time.slice(0, 8) : `${hm}:00`) : hm;
  }

  /** Seed the drafts from the committed value each time the popover opens. */
  begin = (toggle: () => void, open: boolean) => {
    if (!open) {
      let { date, time } = split(this.value);
      this.draftDate = date;
      this.draftTime = this.fit(time);
    }
    toggle();
  };
  onTriggerKey = (open: boolean, toggle: () => void, e: Event) => {
    let key = (e as KeyboardEvent).key;
    if (!open && key === 'ArrowDown') {
      e.preventDefault();
      this.begin(toggle, open);
    }
  };
  setDate = (iso: string) => {
    this.draftDate = iso;
  };
  setTime = (wire: string) => {
    this.draftTime = wire || undefined;
  };
  done = (close: () => void) => {
    if (!this.draftComplete) {
      return;
    }
    let next = `${this.draftDate}T${this.draftTime}`;
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onChange?.(next);
    this.args.onValueChange?.(next);
    close();
  };

  <template>
    <span class='pretui-datetime' data-test-pretui-date-time-picker ...attributes>
      <Popover @placement='bottom-start' @label='Choose date and time'>
        <:trigger as |open toggle|>
          <button
            type='button'
            class='pretui-datetime-trigger'
            aria-haspopup='dialog'
            aria-expanded={{if open 'true' 'false'}}
            aria-label={{this.triggerName}}
            disabled={{@disabled}}
            data-test-pretui-date-time-trigger
            {{on 'click' (fn this.begin toggle open)}}
            {{on 'keydown' (fn this.onTriggerKey open toggle)}}
          >
            {{#if this.display}}
              <span class='pretui-datetime-value' data-test-pretui-date-time-value>{{this.display}}</span>
            {{else}}
              <span class='pretui-datetime-placeholder'>{{this.placeholder}}</span>
            {{/if}}
          </button>
        </:trigger>
        <:default as |close|>
          <div class='pretui-datetime-panel' data-test-pretui-date-time-panel>
            <Calendar @value={{this.draftDate}} @minDate={{@minDate}} @maxDate={{@maxDate}} @onValueChange={{this.setDate}} />
            <div class='pretui-datetime-foot'>
              <TimeInput
                @value={{this.draftTime}}
                @withSeconds={{this.withSeconds}}
                @hourCycle={{@hourCycle}}
                @label='Time'
                @onValueChange={{this.setTime}}
              />
              <Button
                @appearance='accent'
                @size='s'
                aria-disabled={{unless this.draftComplete 'true'}}
                data-test-pretui-date-time-done
                {{on 'click' (fn this.done close)}}
              >Done</Button>
            </div>
          </div>
        </:default>
      </Popover>
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-datetime {
          display: inline-block;
          --pretui-popover-width: calc(222px + 2 * var(--space-4, 11px));
          --pretui-popover-min-width: 0;
        }
        .pretui-datetime-trigger {
          display: flex;
          align-items: center;
          min-inline-size: 13rem;
          min-block-size: var(--pretui-control-h, 2.25rem);
          padding-inline: var(--space-3, 0.5rem);
          border: 0;
          border-radius: var(--radius-control, 6px);
          background: var(--input-background, var(--card));
          box-shadow: 0 0 0 1px var(--input, var(--border));
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 0.78rem);
          text-align: start;
          cursor: pointer;
        }
        .pretui-datetime-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-datetime-trigger:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .pretui-datetime-value {
          font-variant-numeric: tabular-nums;
        }
        .pretui-datetime-placeholder {
          color: var(--muted-foreground);
        }
        .pretui-datetime-panel {
          display: grid;
          gap: var(--space-3, 0.5rem);
        }
        .pretui-datetime-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2, 0.375rem);
          padding-block-start: var(--space-3, 0.5rem);
          border-block-start: 1px solid var(--border);
        }
      }
    </style>
  </template>
}
