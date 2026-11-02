// A key's or a share's limits, edited in place by the key's owner: how many
// calls one caller may make at once, how fast that refills, and how many
// calls it serves in a UTC day and a month across every caller. Each starts at
// the limit in force; only the ones changed are sent. A field left empty goes
// back to the platform's default. These count calls, not money: the service's
// own price for a call is the owner's to look up.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import Button from '../../components/button.gts';
import Input from '../../components/input.gts';
import type { KeyLimitChanges, KeyLimits } from '../../security/keys.ts';

interface Signature {
  Args: {
    limits: KeyLimits;
    // Saves the changes, answering an error message to show, or undefined
    // once they are saved.
    onSave: (changes: KeyLimitChanges) => Promise<string | undefined>;
  };
}

type Field = keyof KeyLimits;

const FIELDS: { name: Field; label: string; hint: string; whole: boolean }[] = [
  {
    name: 'rateBurst',
    label: 'Calls at once, per caller',
    hint: 'How many calls one person can make in a burst.',
    whole: true,
  },
  {
    name: 'rateRefillPerMinute',
    label: 'Calls per minute, per caller',
    hint: 'How fast a caller’s burst refills.',
    whole: false,
  },
  {
    name: 'dailyBudget',
    label: 'Calls per day',
    hint: 'Across everyone, resetting at midnight UTC. Check your plan’s limit with the service.',
    whole: true,
  },
  {
    name: 'monthlyBudget',
    label: 'Calls per month',
    hint: 'Across everyone, resetting on the first of the month, UTC.',
    whole: true,
  },
];

export default class LimitsForm extends Component<Signature> {
  <template>
    <form
      class='limits'
      novalidate
      {{on 'submit' this.save}}
      data-test-key-limits-form
    >
      {{#each this.fields as |field|}}
        <label class='field' data-test-key-limit={{field.name}}>
          <span class='label'>{{field.label}}</span>
          <Input
            @value={{field.value}}
            @onInput={{field.onInput}}
            inputmode={{if field.whole 'numeric' 'decimal'}}
            data-test-key-limit-input={{field.name}}
          />
          <span class='hint'>{{field.hint}}</span>
        </label>
      {{/each}}
      {{#if this.state.error}}
        <p class='error' role='alert' data-test-key-limits-error>
          {{this.state.error}}
        </p>
      {{/if}}
      {{#if this.state.saved}}
        <p class='saved' role='status' data-test-key-limits-saved>Limits saved.</p>
      {{/if}}
      <div class='actions'>
        <Button
          type='submit'
          @kind='primary'
          @size='extra-small'
          @disabled={{this.state.saving}}
          @loading={{this.state.saving}}
          data-test-key-limits-save
        >Save limits</Button>
      </div>
    </form>
    <style scoped>
      .limits {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .field {
        display: grid;
        gap: var(--boxel-sp-5xs);
        align-content: start;
      }
      .label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .hint {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      .error,
      .saved,
      .actions {
        grid-column: 1 / -1;
        margin: 0;
        font-size: var(--boxel-font-size-xs);
      }
      .error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-weight: 500;
      }
      @media (max-width: 480px) {
        .limits {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>

  private values = trackedObject<Record<Field, string>>({
    rateBurst: String(this.args.limits.rateBurst),
    rateRefillPerMinute: String(this.args.limits.rateRefillPerMinute),
    dailyBudget: String(this.args.limits.dailyBudget),
    monthlyBudget: String(this.args.limits.monthlyBudget),
  });

  private state = trackedObject({
    saving: false,
    saved: false,
    error: undefined as string | undefined,
  });

  private get fields() {
    return FIELDS.map((field) => ({
      ...field,
      value: this.values[field.name],
      onInput: (value: string) => {
        this.values[field.name] = value;
        this.state.saved = false;
        this.state.error = undefined;
      },
    }));
  }

  // The fields that differ from the limits in force, or an error naming the
  // first that isn't a limit.
  private changes(): KeyLimitChanges | string {
    let changes: KeyLimitChanges = {};
    for (let field of FIELDS) {
      let text = this.values[field.name].trim();
      if (text === '') {
        changes[field.name] = null;
        continue;
      }
      let value = Number(text);
      let valid =
        Number.isFinite(value) &&
        (field.whole ? Number.isInteger(value) && value >= 1 : value > 0);
      if (!valid) {
        return `${field.label} must be ${field.whole ? 'a whole number of at least 1' : 'a number above 0'}.`;
      }
      if (value !== this.args.limits[field.name]) {
        changes[field.name] = value;
      }
    }
    return changes;
  }

  private save = async (event: Event) => {
    event.preventDefault();
    if (this.state.saving) {
      return;
    }
    let changes = this.changes();
    if (typeof changes === 'string') {
      this.state.error = changes;
      return;
    }
    if (Object.keys(changes).length === 0) {
      this.state.saved = true;
      return;
    }
    this.state.saving = true;
    this.state.error = undefined;
    try {
      let error = await this.args.onSave(changes);
      this.state.error = error;
      this.state.saved = !error;
    } finally {
      this.state.saving = false;
    }
  };
}
