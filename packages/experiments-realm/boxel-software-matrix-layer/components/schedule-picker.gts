import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

// Schedule Picker — "publish now" or "publish later". Render-only: the
// consumer holds the chosen ISO string (or undefined for now) and gets it
// through `@onChange`. The Date is composed from LOCAL calendar parts —
// never string-concatenated into an ISO with Z — because east-of-UTC
// agents scheduling "9am Saturday" mean their 9am, not Greenwich's.

interface Signature {
  Args: {
    value?: string;
    onChange: (isoOrUndefined: string | undefined) => void;
  };
  Element: HTMLElement;
}

export class SchedulePicker extends GlimmerComponent<Signature> {
  @tracked mode: 'now' | 'later' = this.args.value ? 'later' : 'now';
  @tracked datePart = this.args.value ? toDatePart(this.args.value) : '';
  @tracked timePart = this.args.value ? toTimePart(this.args.value) : '';

  chooseNow = () => {
    this.mode = 'now';
    this.args.onChange(undefined);
  };

  chooseLater = () => {
    this.mode = 'later';
    this.emit();
  };

  onDate = (event: Event) => {
    this.datePart = (event.target as HTMLInputElement).value;
    this.mode = 'later';
    this.emit();
  };

  onTime = (event: Event) => {
    this.timePart = (event.target as HTMLInputElement).value;
    this.mode = 'later';
    this.emit();
  };

  emit() {
    if (this.mode !== 'later' || !this.datePart) {
      return;
    }
    let [y, m, d] = this.datePart.split('-').map(Number);
    let [hh, mm] = (this.timePart || '09:00').split(':').map(Number);
    // Local calendar parts → a real Date → ISO for storage.
    let when = new Date(y, m - 1, d, hh, mm);
    if (!isNaN(when.getTime())) {
      this.args.onChange(when.toISOString());
    }
  }

  <template>
    <fieldset class='schedule' ...attributes>
      <legend class='legend'>Schedule for later?</legend>
      <label class='option'>
        <input
          type='radio'
          name='schedule-mode'
          checked={{this.isNow}}
          {{on 'change' this.chooseNow}}
        />
        <span>Publish now</span>
      </label>
      <label class='option'>
        <input
          type='radio'
          name='schedule-mode'
          checked={{this.isLater}}
          {{on 'change' this.chooseLater}}
        />
        <span>Schedule:</span>
        <input
          type='date'
          class='part'
          value={{this.datePart}}
          {{on 'change' this.onDate}}
        />
        <input
          type='time'
          class='part'
          value={{this.timePart}}
          {{on 'change' this.onTime}}
        />
      </label>
    </fieldset>
    <style scoped>
      .schedule {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm) var(--boxel-sp-sm);
        display: grid;
        gap: var(--boxel-sp-xs);
        margin: 0;
        font-size: 0.8125rem;
        color: var(--foreground, var(--boxel-dark));
      }
      .legend {
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
        padding: 0 var(--boxel-sp-5xs);
      }
      .option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        cursor: pointer;
        flex-wrap: wrap;
      }
      .option input[type='radio'] {
        accent-color: var(--primary, var(--boxel-dark));
      }
      .option input:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 1px;
      }
      .part {
        font: inherit;
        font-size: 0.8125rem;
        padding: 2px 6px;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: calc(var(--radius, var(--boxel-border-radius)) / 1.5);
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
    </style>
  </template>

  get isNow() {
    return this.mode === 'now';
  }
  get isLater() {
    return this.mode === 'later';
  }
}

function toDatePart(iso: string): string {
  let d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '';
  }
  let mm = String(d.getMonth() + 1).padStart(2, '0');
  let dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function toTimePart(iso: string): string {
  let d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '';
  }
  let hh = String(d.getHours()).padStart(2, '0');
  let mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default SchedulePicker;
