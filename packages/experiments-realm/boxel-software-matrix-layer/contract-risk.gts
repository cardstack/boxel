import {
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import { htmlSafe } from '@ember/template';

import { ScorecardCriterionField } from './scorecard-field';
import { StatePill } from './components/state-pill';
import {
  stateColor,
  stateColorOf,
  type Hue,
  type StateColor,
} from './utils/index';

/**
 * A contract's composite risk grade, derived from five weighted factors.
 *
 * REUSE NOTE — this consumes `ScorecardCriterionField` (name + 1–5
 * `ScoreField` + notes) from the matrix realm's scorecard-field.gts, which is
 * genuinely domain-neutral, and inherits its star editor for free.
 *
 * It deliberately does NOT consume `ScorecardField` itself. That field bundles
 * the neutral criteria list together with a `recommendation` whose options are
 * hard-coded to hiring vocabulary — strong-hire / hire / no-hire /
 * strong-no-hire. Storing "no-hire" on a vendor agreement would be nonsense on
 * disk, not just on screen, and serialization is the expensive thing to get
 * wrong.
 *
 * UPSTREAM ASK (block-factory): `ScorecardField.recommendation` should take its
 * option set from configuration the way `statusField({options, transitions})`
 * already does. The moment it does, this field collapses into a config object
 * and these five bands move into the call site.
 */

export type RiskGrade = 'low' | 'medium' | 'high' | 'critical';

export const RISK_GRADES: RiskGrade[] = ['low', 'medium', 'high', 'critical'];

export const RISK_GRADE_LABELS: Record<RiskGrade, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const RISK_GRADE_HUE: Record<RiskGrade, Hue> = {
  low: 'green',
  medium: 'amber',
  high: 'orange',
  critical: 'red',
};

export const RISK_GRADE_COLORS: Record<string, StateColor> = Object.fromEntries(
  RISK_GRADES.map((g) => [g, stateColor(RISK_GRADE_HUE[g])]),
);

/**
 * The five factors from the spec's risk table, with the weight each carries.
 *
 * Weights are not equal on purpose: an uncapped liability clause is the single
 * fact most likely to turn a routine agreement into an existential one, so it
 * outweighs contract value, which is merely large. The weights sum to 1 so the
 * composite reads as a percentage without a second normalisation step.
 */
export interface RiskFactor {
  key: string;
  name: string;
  weight: number;
  /** What a 1 and a 5 mean, so a scorer is not guessing at the scale. */
  low: string;
  high: string;
}

export const RISK_FACTORS: RiskFactor[] = [
  {
    key: 'value',
    name: 'Value',
    weight: 0.2,
    low: 'Under $50K',
    high: 'Over $500K',
  },
  {
    key: 'term',
    name: 'Term',
    weight: 0.15,
    low: 'Under a year',
    high: 'Over three years',
  },
  {
    key: 'liability',
    name: 'Liability',
    weight: 0.3,
    low: 'Capped at fees paid',
    high: 'Uncapped',
  },
  {
    key: 'data',
    name: 'Data',
    weight: 0.2,
    low: 'No personal data',
    high: 'Sensitive personal data',
  },
  {
    key: 'deviation',
    name: 'Deviation',
    weight: 0.15,
    low: 'Standard language throughout',
    high: 'Major departures from the clause library',
  },
];

/** The criteria a fresh contract starts with, so nobody scores a blank list. */
export function defaultRiskCriteria() {
  return RISK_FACTORS.map((f) => ({ name: f.name, score: null, notes: null }));
}

function weightOf(name?: string | null): number {
  let f = RISK_FACTORS.find(
    (x) => x.name.toLowerCase() === (name ?? '').trim().toLowerCase(),
  );
  // An unrecognised criterion still counts — a contract may carry a factor
  // this app did not anticipate, and silently dropping it would understate the
  // risk. It gets the mean weight rather than zero.
  return f ? f.weight : 1 / RISK_FACTORS.length;
}

/**
 * Weighted mean of the scored criteria, rescaled from the 1–5 star range to
 * 0–100.
 *
 * Unscored criteria are excluded from BOTH the numerator and the denominator,
 * so a half-filled scorecard reports the risk of what was actually assessed
 * rather than diluting it toward zero. Returns undefined when nothing has been
 * scored at all — which is not the same as low risk, and must not render as it.
 */
export function riskScoreOf(
  criteria: { name?: string | null; score?: number | null }[] | undefined,
): number | undefined {
  let scored = (criteria ?? []).filter(
    (c) => typeof c?.score === 'number' && Number.isFinite(c.score),
  );
  if (!scored.length) return undefined;
  let totalWeight = scored.reduce((sum, c) => sum + weightOf(c.name), 0);
  if (!totalWeight) return undefined;
  let weighted = scored.reduce(
    (sum, c) => sum + weightOf(c.name) * ((c.score as number) - 1),
    0,
  );
  return Math.round((weighted / totalWeight / 4) * 100);
}

export function riskGradeOf(score?: number | null): RiskGrade | undefined {
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function riskGradeLabel(grade?: string | null): string {
  return RISK_GRADE_LABELS[grade as RiskGrade] ?? 'Not assessed';
}

export class RiskRatingField extends FieldDef {
  static displayName = 'Risk Rating';

  @field criteria = containsMany(ScorecardCriterionField);
  @field notes = contains(TextAreaField);

  // Computed, never stored. A contract whose liability cap is renegotiated
  // must not keep yesterday's CRITICAL badge, and a stored grade is exactly
  // the value that drifts once a second writer touches the criteria.
  @field score = contains(NumberField, {
    computeVia: function (this: RiskRatingField) {
      return riskScoreOf(this.criteria);
    },
  });

  @field grade = contains(StringField, {
    computeVia: function (this: RiskRatingField) {
      return riskGradeOf(this.score);
    },
  });

  @field summary = contains(StringField, {
    computeVia: function (this: RiskRatingField) {
      return this.grade
        ? `${riskGradeLabel(this.grade)} · ${this.score}/100`
        : 'Not assessed';
    },
  });

  static atom = class Atom extends Component<typeof this> {
    get label() {
      return riskGradeLabel(this.args.model?.grade);
    }
    get hue(): Hue {
      return gradeHue(this.args.model?.grade);
    }
    <template>
      <StatePill @label={{this.label}} @hue={{this.hue}} @dot={{true}} />
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get color(): StateColor {
      return stateColorOf(RISK_GRADE_COLORS, this.args.model?.grade);
    }

    get label() {
      return riskGradeLabel(this.args.model?.grade);
    }

    get hue(): Hue {
      return gradeHue(this.args.model?.grade);
    }

    get barStyle() {
      let pct = this.args.model?.score ?? 0;
      return htmlSafe(`width: ${pct}%; background: ${this.color.ring};`);
    }

    get headStyle() {
      return htmlSafe(`color: ${this.color.fg};`);
    }

    <template>
      <section class='risk' aria-label='Contract risk rating'>
        <header class='risk-head'>
          <StatePill @label={{this.label}} @hue={{this.hue}} @dot={{true}} />
          {{#if @model.score}}
            <span class='risk-score' style={{this.headStyle}}>
              {{@model.score}}<span class='risk-of'>/100</span>
            </span>
          {{else}}
            <span class='risk-none'>No factors scored yet</span>
          {{/if}}
        </header>

        {{#if @model.score}}
          <div
            class='risk-track'
            role='progressbar'
            aria-valuenow={{@model.score}}
            aria-valuemin='0'
            aria-valuemax='100'
            aria-label='Composite risk score'
          >
            <span class='risk-fill' style={{this.barStyle}}></span>
          </div>
        {{/if}}

        {{#if @model.criteria.length}}
          <div class='risk-factors'>
            <@fields.criteria />
          </div>
        {{/if}}

        {{#if @model.notes}}
          <p class='risk-notes'>{{@model.notes}}</p>
        {{/if}}
      </section>

      <style scoped>
        .risk {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .risk-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .risk-score {
          margin-left: auto;
          font-weight: 700;
          font-size: var(--boxel-font-size);
          font-variant-numeric: tabular-nums;
        }
        .risk-of {
          font-weight: 400;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .risk-none {
          margin-left: auto;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .risk-track {
          height: 8px;
          border-radius: 3px;
          background: color-mix(
            in oklch,
            var(--foreground, var(--boxel-dark)) 8%,
            transparent
          );
          overflow: hidden;
        }
        .risk-track > .risk-fill {
          display: block;
          height: 100%;
          border-radius: 3px;
        }
        .risk-factors {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .risk-notes {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

// Template helper kept module-local: the hue map is an implementation detail of
// this field, and exporting it would invite consumers to colour risk their own
// way, which is how one product ends up with two risk palettes.
function gradeHue(grade?: string | null): Hue {
  return RISK_GRADE_HUE[grade as RiskGrade] ?? 'slate';
}

export default RiskRatingField;
