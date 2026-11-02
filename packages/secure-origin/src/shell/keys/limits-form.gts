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
import BoxelInput from '../../components/input.gts';
import type { KeyLimitChanges, KeyLimits } from '../../security/keys.ts';

interface Signature {
  Args: {
    limits: KeyLimits;
    // A share's limits, which speak of each person and of everyone; a
    // personal key's serve only its owner.
    shared?: boolean;
    // Saves the changes, answering the limits in force afterwards, or an
    // error message to show.
    onSave: (changes: KeyLimitChanges) => Promise<KeyLimits | string>;
  };
}

type Field = keyof KeyLimits;

function textOf(limits: KeyLimits): Record<Field, string> {
  return {
    rateBurst: String(limits.rateBurst),
    rateRefillPerMinute: String(limits.rateRefillPerMinute),
    dailyBudget: String(limits.dailyBudget),
    monthlyBudget: String(limits.monthlyBudget),
  };
}

interface FieldSpec {
  name: Field;
  label: string;
  hint: string;
  whole: boolean;
}

// The limits in two groups: how fast calls may come, which for a share is
// each person's own, and how many the key serves in all, across everyone. A
// personal key serves only its owner, so its groups don't speak of people.
function groups(shared: boolean): { legend: string; fields: FieldSpec[] }[] {
  return [
    {
      legend: shared ? 'Each person' : 'How fast',
      fields: [
        {
          name: 'rateBurst',
          label: 'Calls at once',
          hint: shared
            ? 'How many calls one person can make in a burst.'
            : 'How many calls you can make in a burst.',
          whole: true,
        },
        {
          name: 'rateRefillPerMinute',
          label: 'Calls a minute after that',
          hint: 'How fast the burst refills.',
          whole: false,
        },
      ],
    },
    {
      legend: shared ? 'The key, in total across everyone' : 'How many',
      fields: [
        {
          name: 'dailyBudget',
          label: 'Calls a day',
          hint: 'Resets at midnight UTC. Check your plan’s limit with the service.',
          whole: true,
        },
        {
          name: 'monthlyBudget',
          label: 'Calls a month',
          hint: 'Resets on the first of the month, UTC.',
          whole: true,
        },
      ],
    },
  ];
}

const FIELDS: FieldSpec[] = groups(false).flatMap((group) => group.fields);

export default class LimitsForm extends Component<Signature> {
  <template>
    <form
      class='limits'
      novalidate
      {{on 'submit' this.save}}
      data-test-key-limits-form
    >
      {{#each this.groups as |group|}}
        <fieldset class='group' data-test-key-limit-group>
          <legend class='legend'>{{group.legend}}</legend>
          {{#each group.fields as |field|}}
            <label class='field' data-test-key-limit={{field.name}}>
              <span class='label'>{{field.label}}</span>
              <BoxelInput
                @value={{field.value}}
                @onInput={{field.onInput}}
                inputmode={{if field.whole 'numeric' 'decimal'}}
                data-test-key-limit-input={{field.name}}
              />
              <span class='hint'>{{field.hint}}</span>
            </label>
          {{/each}}
        </fieldset>
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
      .group {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
        grid-column: 1 / -1;
        margin: 0;
        padding: 0;
        border: none;
      }
      .legend {
        grid-column: 1 / -1;
        padding: 0;
        margin-bottom: var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--muted-foreground);
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
        .limits,
        .group {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>

  // The limits the fields were last filled from, which a field is compared
  // against to tell whether it changed.
  private current: KeyLimits = this.args.limits;

  private values = trackedObject<Record<Field, string>>(
    textOf(this.args.limits),
  );

  private fill(limits: KeyLimits) {
    this.current = limits;
    Object.assign(this.values, textOf(limits));
  }

  private state = trackedObject({
    saving: false,
    saved: false,
    error: undefined as string | undefined,
  });

  private get groups() {
    return groups(Boolean(this.args.shared)).map((group) => ({
      legend: group.legend,
      fields: group.fields.map((field) => ({
        ...field,
        value: this.values[field.name],
        onInput: (value: string) => {
          this.values[field.name] = value;
          this.state.saved = false;
          this.state.error = undefined;
        },
      })),
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
      if (value !== this.current[field.name]) {
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
      let answer = await this.args.onSave(changes);
      if (typeof answer === 'string') {
        this.state.error = answer;
      } else {
        // A field left empty now shows the default it went back to.
        this.fill(answer);
        this.state.saved = true;
      }
    } finally {
      this.state.saving = false;
    }
  };
}
