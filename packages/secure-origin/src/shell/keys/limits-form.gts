// A key's or a share's limits, edited in place by the key's owner: how many
// calls one caller may make at once, how fast that refills, and how many
// calls it serves in a UTC day and a month across every caller. A field holds
// the value its owner set, or is empty where they left the default, which it
// shows as its placeholder and spells out under it. Only the fields changed
// are sent, and a field emptied goes back to the default. An unset monthly
// budget follows the daily one, so its default moves as the daily field is
// edited; a monthly budget the owner set stays put. These count calls, not
// money: the service's own price for a call is the owner's to look up.
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { Button } from '@cardstack/pretui/components/button';
import { Input } from '@cardstack/pretui/components/input';
import { ignoredByPasswordManagers } from '@cardstack/pretui/password-managers';
import type {
  KeyLimitChanges,
  KeyLimitName,
  KeyLimits,
} from '../../security/keys.ts';

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

type Field = KeyLimitName;

// Whole budgets with their thousands grouped, and a refill rate with every
// decimal it carries.
const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });

// The largest value a limit may hold: what the realm server's columns hold,
// and the most an unset monthly budget can follow the daily budget to.
const MAX_KEY_LIMIT = 2_147_483_647;

// Whether the realm server said which limits the owner set and what the
// defaults are. One that answers only the limits in force (an older task
// still serving while a deploy rolls out) doesn't.
function knowsDefaults(limits: KeyLimits): boolean {
  return Boolean(limits.set && limits.defaults);
}

// Limits as the form reads them. Limits that don't say which the owner set
// are read as if the owner had set each of them: every field filled with the
// limit in force, and, since `knowsDefaults` is false, no field described or
// placeheld as a default.
function limitsView(limits: KeyLimits): KeyLimits {
  if (knowsDefaults(limits)) {
    return limits;
  }
  return {
    ...limits,
    set: {
      rateBurst: limits.rateBurst,
      rateRefillPerMinute: limits.rateRefillPerMinute,
      dailyBudget: limits.dailyBudget,
      monthlyBudget: limits.monthlyBudget,
    },
    defaults: {
      rateBurst: limits.rateBurst,
      rateRefillPerMinute: limits.rateRefillPerMinute,
      dailyBudget: limits.dailyBudget,
      monthlyBudgetDays: 30,
    },
  };
}

// The fields' text: what the owner set, empty where they left the default.
function textOf(limits: KeyLimits): Record<Field, string> {
  let text = (value: number | null) => (value == null ? '' : String(value));
  return {
    rateBurst: text(limits.set.rateBurst),
    rateRefillPerMinute: text(limits.set.rateRefillPerMinute),
    dailyBudget: text(limits.set.dailyBudget),
    monthlyBudget: text(limits.set.monthlyBudget),
  };
}

// A number as typed: plain digits, or thousands grouped by commas the way
// the defaults are shown. Misplaced commas (`1,2,3`) are not a number.
const TYPED_NUMBER = /^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;

// A field's text as the limit it names, or undefined when it isn't one.
function limitOf(text: string, whole: boolean): number | undefined {
  let typed = text.trim();
  if (!TYPED_NUMBER.test(typed)) {
    return undefined;
  }
  let plain = typed.replace(/,/g, '');
  let value = Number(plain);
  let valid =
    plain !== '' &&
    Number.isFinite(value) &&
    (whole ? Number.isInteger(value) && value >= 1 : value > 0);
  return valid ? value : undefined;
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
      data-form-type='other'
      {{on 'submit' this.save}}
      data-test-key-limits-form
    >
      {{#each this.groups as |group|}}
        <fieldset class='group' data-test-key-limit-group>
          <legend class='legend'>{{group.legend}}</legend>
          {{#each group.fields as |field|}}
            <div class='field' data-test-key-limit={{field.name}}>
              <label class='label' for={{field.inputId}}>{{field.label}}</label>
              <Input
                @controlId={{field.inputId}}
                @value={{field.value}}
                @onInput={{field.onInput}}
                placeholder={{field.placeholder}}
                @describedBy='{{field.hintId}} {{field.noteId}}'
                inputmode={{if field.whole 'numeric' 'decimal'}}
                data-test-key-limit-input={{field.name}}
                {{ignoredByPasswordManagers}}
              />
              <span class='hint' id={{field.hintId}}>{{field.hint}}</span>
              <span
                class='hint'
                id={{field.noteId}}
                data-test-key-limit-default={{field.name}}
              >{{field.defaultNote}}</span>
            </div>
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
          @variant='primary'
          @size='xs'
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

  // The limits the fields were last filled from, whose `set` a field is
  // compared against to tell whether it changed. Tracked, since the defaults
  // the fields show come from it.
  private guid = guidFor(this);

  private filled = trackedObject({
    limits: limitsView(this.args.limits),
    knowsDefaults: knowsDefaults(this.args.limits),
  });

  private get current(): KeyLimits {
    return this.filled.limits;
  }

  private values = trackedObject<Record<Field, string>>(
    textOf(this.filled.limits),
  );

  private fill(limits: KeyLimits) {
    this.filled.limits = limitsView(limits);
    this.filled.knowsDefaults = knowsDefaults(limits);
    Object.assign(this.values, textOf(this.filled.limits));
  }

  private state = trackedObject({
    saving: false,
    saved: false,
    error: undefined as string | undefined,
  });

  // What each field takes while it's empty: the platform's default, or for
  // the monthly budget that many days of the daily budget the form holds.
  private get defaults(): Record<Field, number> {
    let { defaults } = this.current;
    let daily = limitOf(this.values.dailyBudget, true) ?? defaults.dailyBudget;
    return {
      rateBurst: defaults.rateBurst,
      rateRefillPerMinute: defaults.rateRefillPerMinute,
      dailyBudget: defaults.dailyBudget,
      monthlyBudget: Math.min(
        MAX_KEY_LIMIT,
        daily * defaults.monthlyBudgetDays,
      ),
    };
  }

  // Under each field: the default it takes, said as the value in force when
  // the field is empty and as what emptying it gives when it isn't.
  private defaultNote(field: Field): string {
    let value = COUNT.format(this.defaults[field]);
    let empty = this.values[field].trim() === '';
    if (field === 'monthlyBudget') {
      let { defaults } = this.current;
      let daily = COUNT.format(
        limitOf(this.values.dailyBudget, true) ?? defaults.dailyBudget,
      );
      let sum = `${defaults.monthlyBudgetDays} × ${daily} = ${value}`;
      return empty
        ? `Follows calls a day: ${sum}.`
        : `Leave empty to follow calls a day: ${sum}.`;
    }
    return empty
      ? `Using the default, ${value}.`
      : `Leave empty for the default, ${value}.`;
  }

  private get groups() {
    return groups(Boolean(this.args.shared)).map((group) => ({
      legend: group.legend,
      fields: group.fields.map((field) => ({
        ...field,
        value: this.values[field.name],
        placeholder: this.filled.knowsDefaults
          ? COUNT.format(this.defaults[field.name])
          : undefined,
        inputId: `${this.guid}-${field.name}`,
        hintId: `${this.guid}-${field.name}-hint`,
        noteId: `${this.guid}-${field.name}-default`,
        defaultNote: this.filled.knowsDefaults
          ? this.defaultNote(field.name)
          : '',
        onInput: (value: string) => {
          this.values[field.name] = value;
          this.state.saved = false;
          this.state.error = undefined;
        },
      })),
    }));
  }

  // The fields that differ from what the owner set, or an error naming the
  // first that isn't a limit. A field emptied goes back to the default; one
  // left empty sends nothing, so a default stays a default.
  private changes(): KeyLimitChanges | string {
    let changes: KeyLimitChanges = {};
    for (let field of FIELDS) {
      let set = this.current.set[field.name];
      if (this.values[field.name].trim() === '') {
        if (set !== null) {
          changes[field.name] = null;
        }
        continue;
      }
      let value = limitOf(this.values[field.name], field.whole);
      if (value === undefined) {
        return `${field.label} must be ${field.whole ? 'a whole number of at least 1' : 'a number above 0'}.`;
      }
      if (value !== set) {
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
        // A field emptied stays empty, showing the default it went back to.
        this.fill(answer);
        this.state.saved = true;
      }
    } finally {
      this.state.saving = false;
    }
  };
}
