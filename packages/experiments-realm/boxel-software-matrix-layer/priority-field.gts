import { Component, StringField } from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import FlagIcon from '@cardstack/boxel-icons/flag';

import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';

/**
 * How urgent this is, on a scale the consumer defines.
 *
 * Separate from status on purpose: status says where a record is in its
 * process, priority says how much the process is allowed to wait. They change
 * for different reasons and by different people — an agent moves a ticket to
 * Pending, a manager moves it to P1 — and merging them is what produces
 * lifecycles with "Urgent" sitting between "Open" and "Resolved".
 *
 * The block carries the ORDER, not just the labels. Sorting a queue by urgency
 * is the single most common thing anyone does with this field, and a string
 * sort puts P1 next to P4 and Critical after Low.
 */
export interface PriorityOption {
  value: string;
  label?: string;
  hue?: Hue;
  /** Lower sorts first. Defaults to array position. */
  rank?: number;
  /** Multiplies a target duration. ServiceDesk uses it for SLA maths. */
  factor?: number;
  /**
   * One sentence on when this level applies, in the reader's words.
   *
   * The block has no opinion on what P1 means — a helpdesk, a bug tracker and
   * a triage board each define it differently — so the consumer supplies it
   * and the block only agrees to carry it. Without this, "P1" is a label
   * whose meaning lives in somebody's head.
   */
  meaning?: string;
}

export interface PriorityFieldConfig {
  options: PriorityOption[];
  displayName?: string;
  icon?: unknown;
  /**
   * The atom is the short form used in dense rows — a queue line, a fitted
   * badge. When false the atom shows the full label instead of the bare value.
   */
  shortAtom?: boolean;
}

export interface PriorityFieldClass {
  priorityOptions: PriorityOption[];
}

export function priorityField(config: PriorityFieldConfig) {
  let { options } = config;
  let short = config.shortAtom ?? true;

  let Base = enumField(StringField, {
    displayName: config.displayName ?? 'Priority',
    icon: config.icon ?? FlagIcon,
    options: options.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
    })),
  });

  class Priority extends Base {
    static displayName = config.displayName ?? 'Priority';
    static priorityOptions = options;

    static embedded = class Embedded extends Component<typeof this> {
      get option() {
        return options.find((o) => o.value === (this.args.model as unknown));
      }
      <template>
        <StatePill
          @label={{if this.option.label this.option.label @model}}
          @hue={{this.option.hue}}
        />
      </template>
    };

    // The top priority is the one state allowed a solid fill. Everything else
    // in a queue row is a diluted chip, so the eye lands on the P1s first
    // without anyone having to read a word.
    static atom = class Atom extends Component<typeof this> {
      get option() {
        return options.find((o) => o.value === (this.args.model as unknown));
      }
      get isTop() {
        return this.option
          ? priorityRankOf(options, this.option.value) === 0
          : false;
      }
      get label() {
        return short
          ? this.args.model
          : (this.option?.label ?? this.args.model);
      }
      <template>
        <StatePill
          @label={{this.label}}
          @hue={{this.option.hue}}
          @emphatic={{this.isTop}}
        />
      </template>
    };
  }

  return Priority;
}

function priorityRankOf(
  options: PriorityOption[],
  value?: string | null,
): number {
  let idx = options.findIndex((o) => o.value === value);
  if (idx === -1) {
    // Unset sorts last, not first: a record nobody has triaged should not
    // outrank one somebody deliberately marked critical.
    return Number.MAX_SAFE_INTEGER;
  }
  return options[idx]!.rank ?? idx;
}

export function priorityRank(
  fieldClass: PriorityFieldClass,
  value?: string | null,
): number {
  return priorityRankOf(fieldClass.priorityOptions, value);
}

export function priorityOption(
  fieldClass: PriorityFieldClass,
  value?: string | null,
): PriorityOption | undefined {
  return fieldClass.priorityOptions.find((o) => o.value === value);
}

export function priorityFactor(
  fieldClass: PriorityFieldClass,
  value?: string | null,
): number {
  return priorityOption(fieldClass, value)?.factor ?? 1;
}

/** The neutral default for consumers with no scheme of their own. */
export const PriorityField = priorityField({
  displayName: 'Priority',
  shortAtom: false,
  options: [
    { value: 'Urgent', hue: 'red', factor: 0.25 },
    { value: 'High', hue: 'orange', factor: 0.5 },
    { value: 'Normal', hue: 'amber', factor: 1 },
    { value: 'Low', hue: 'slate', factor: 2 },
  ],
});

export default PriorityField;
