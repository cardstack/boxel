import { Component, StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import CircleDotIcon from '@cardstack/boxel-icons/circle-dot';

import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';

/**
 * A lifecycle status — the generic block, not a ticket's version of one.
 *
 * The matrix has a Status row at the Structures layer with nothing behind it;
 * the only status field in the codebase is an unexported `class Status extends
 * StringField` inside the blog listing whose values are hardcoded to
 * Published/Draft. This is the general form of that: the option set, the
 * colour of each option, and the legal moves between them are all supplied by
 * the consumer.
 *
 * The transition graph is the part worth having. Without it every status field
 * is a free-text dropdown, and every lifecycle in every app is one careless
 * click away from a record that skipped the middle of its own process — a
 * ticket closed without ever being worked, an invoice paid before it was
 * issued. Storing the graph next to the options is what makes the field able
 * to answer "may I?" instead of only "what are the choices?".
 */
export interface StatusOption {
  value: string;
  label?: string;
  hue?: Hue;
  /**
   * Nothing follows a terminal status except a deliberate re-open. Consumers
   * read it to grey out actions rather than to block them.
   */
  terminal?: boolean;
  /**
   * Free-form marker for consumers with a clock: ServiceDesk reads it to stop
   * the SLA timer, a billing app could read it to stop dunning. The block
   * itself never interprets it.
   */
  holds?: boolean;
  /**
   * One line explaining what the status MEANS, in the reader's words — the
   * consequence, not the name restated.
   *
   * Consumers render it where the choice is made: a menu subtitle, a hover
   * hint. It exists because a status vocabulary is never self-explanatory to
   * someone learning the tool — "Pending" and "On Hold" both read as
   * "waiting", and nothing on screen said who is being waited on.
   */
  meaning?: string;
}

export interface StatusFieldConfig {
  options: StatusOption[];
  /** value → the values that may follow it. Absent = anything goes. */
  transitions?: Record<string, string[]>;
  displayName?: string;
  icon?: unknown;
}

export interface StatusFieldClass {
  statusOptions: StatusOption[];
  statusTransitions?: Record<string, string[]>;
}

function optionOf(
  options: StatusOption[],
  value?: string | null,
): StatusOption | undefined {
  return options.find((o) => o.value === value);
}

/**
 * Build a status field bound to one lifecycle.
 *
 * Returns a real FieldDef subclass, so the edit template is the constrained
 * dropdown that comes with `enumField` — no hand-rolled select, and no way to
 * store a value that is not in the list.
 */
export function statusField(config: StatusFieldConfig) {
  let { options, transitions } = config;

  let Base = enumField(StringField, {
    displayName: config.displayName ?? 'Status',
    icon: config.icon ?? CircleDotIcon,
    options: options.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
    })),
  });

  class Status extends Base {
    static displayName = config.displayName ?? 'Status';
    static statusOptions = options;
    static statusTransitions = transitions;

    static embedded = class Embedded extends Component<typeof this> {
      get option() {
        return optionOf(options, this.args.model as unknown as string);
      }
      <template>
        <StatePill
          @label={{if this.option.label this.option.label @model}}
          @hue={{this.option.hue}}
          @dot={{true}}
        />
      </template>
    };

    static atom = class Atom extends Component<typeof this> {
      get option() {
        return optionOf(options, this.args.model as unknown as string);
      }
      <template>
        <StatePill @label={{@model}} @hue={{this.option.hue}} />
      </template>
    };
  }

  return Status;
}

/** Whether `to` may follow `from` under this field's graph. */
export function canTransition(
  fieldClass: StatusFieldClass,
  from?: string | null,
  to?: string | null,
): boolean {
  if (!from || !to || from === to) {
    return false;
  }
  let graph = fieldClass.statusTransitions;
  if (!graph) {
    return true;
  }
  return (graph[from] ?? []).includes(to);
}

/** The statuses reachable from here — what an action menu should offer. */
export function nextStatuses(
  fieldClass: StatusFieldClass,
  from?: string | null,
): StatusOption[] {
  let graph = fieldClass.statusTransitions;
  let allowed = from && graph ? (graph[from] ?? []) : undefined;
  return fieldClass.statusOptions.filter((o) =>
    allowed ? allowed.includes(o.value) : o.value !== from,
  );
}

export function statusOption(
  fieldClass: StatusFieldClass,
  value?: string | null,
): StatusOption | undefined {
  return optionOf(fieldClass.statusOptions, value);
}

export function statusHue(
  fieldClass: StatusFieldClass,
  value?: string | null,
): Hue {
  return optionOf(fieldClass.statusOptions, value)?.hue ?? 'slate';
}

/**
 * A neutral four-state lifecycle for consumers that just want a status and do
 * not have opinions yet. Anything with a real process should call
 * `statusField` with its own options instead of adopting this.
 */
export const StatusField = statusField({
  displayName: 'Status',
  options: [
    { value: 'Draft', hue: 'slate' },
    { value: 'Active', hue: 'teal' },
    { value: 'Done', hue: 'green', terminal: true, holds: true },
    { value: 'Cancelled', hue: 'slate', terminal: true, holds: true },
  ],
  transitions: {
    Draft: ['Active', 'Cancelled'],
    Active: ['Done', 'Cancelled'],
    Done: ['Active'],
    Cancelled: ['Active'],
  },
});

export default StatusField;
