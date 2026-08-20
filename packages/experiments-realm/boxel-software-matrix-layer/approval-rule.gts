import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import TextAreaField from '@cardstack/base/text-area';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import enumField from '@cardstack/base/enum';
import GavelIcon from '@cardstack/boxel-icons/gavel';
import ScaleIcon from '@cardstack/boxel-icons/scale';
import UsersIcon from '@cardstack/boxel-icons/users';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';

import { ContractTypeField, contractTypeLabel } from './contract-type';
import { StatePill } from './components/state-pill';
import { formatMoney } from './money';

/**
 * APPROVAL RULE — the declarative engine the spec asks for.
 *
 *     IF contract_type = "Vendor" AND value > $100,000
 *       THEN require: [Legal] -> [Finance] -> [CFO]
 *
 * WHY THIS IS A CARD, not a config file. The rule that fired is the answer to
 * "why does this need my approval", and every researched CLM product models
 * that condition and then throws it away at render time, falling back to
 * instruction text a human typed. Keeping the rule as data means the app can
 * state the actual reason, and the reason cannot drift from the routing.
 *
 * CONDITIONS ARE AND-ED. Each populated condition must hold. That is a
 * deliberate limit: OR across rules is expressed by writing two rules, which
 * keeps each rule readable on its own. Nested boolean groups are not modelled —
 * they make a rule unreadable at exactly the moment someone is trying to work
 * out why they were asked to approve something.
 */

export interface RuleSubject {
  contractType?: string | null;
  value?: { amount?: number | null } | null;
  riskGrade?: string | null;
  deviationCount?: number | null;
  handlesSensitiveData?: boolean | null;
}

const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

/**
 * The ordered grades, as a closed set.
 *
 * `ruleMatches` compares by INDEX in `RISK_ORDER`, so a value outside the set
 * scores -1 and the rule silently never fires. Free text here is therefore not
 * merely untidy — a typo disables the rule with no error anywhere.
 */
export const RiskGradeField = enumField(StringField, {
  options: RISK_ORDER.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
  displayName: 'Minimum Risk Grade',
  icon: GavelIcon,
});

/* Defined ABOVE the class on purpose: `@field` decorators run at
   class-definition time, so a field type declared further down the module is
   still in its temporal dead zone and fails with
   "Cannot access 'RiskGradeField' before initialization" — at index time, not
   at lint or typecheck time. */

export class ApprovalRule extends CardDef {
  static displayName = 'Approval Rule';
  static icon = GavelIcon;

  @field ruleName = contains(StringField);

  /** Lower runs first when several rules match. */
  @field priority = contains(NumberField);
  @field isActive = contains(BooleanField);

  // ---- conditions (all populated ones must hold) ---------------------------

  @field appliesToTypes = containsMany(ContractTypeField);
  @field minValue = contains(AmountWithCurrency);
  @field minRiskGrade = contains(RiskGradeField);
  @field minDeviations = contains(NumberField);
  @field requiresSensitiveData = contains(BooleanField);

  // ---- outcome -------------------------------------------------------------

  /** Ordered approver roles: Legal -> Finance -> CFO. */
  @field requiredRoles = containsMany(StringField);
  @field isParallel = contains(BooleanField);
  @field guidance = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ApprovalRule) {
      return this.ruleName ?? 'Untitled rule';
    },
  });

  /**
   * The domain question: "when does this fire, and who does it summon?"
   *
   * So the IF and the THEN are the whole card, rendered as the two halves of
   * one sentence — the chain is the hero because that is the consequence, and
   * the conditions sit above it because that is the trigger. A reader checking
   * whether a rule is too broad reads the top; one checking whether it routes
   * correctly reads the bottom.
   */
  static isolated = class Isolated extends Component<typeof ApprovalRule> {
    get roles(): string[] {
      return (this.args.model?.requiredRoles ?? []).filter(Boolean) as string[];
    }
    get inactive() {
      return this.args.model?.isActive === false;
    }
    <template>
      <article class='ar-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'><GavelIcon role='presentation' />Approval rule</p>
            <h1>{{@model.cardTitle}}</h1>
            <div class='hero-pills'>
              {{#if this.inactive}}
                <StatePill @label='Inactive' @hue='red' @dot={{true}} />
              {{else}}
                <StatePill @label='Active' @hue='green' @dot={{true}} />
              {{/if}}
              {{#if @model.isParallel}}
                <StatePill @label='Parallel' @hue='blue' />
              {{else}}
                <StatePill @label='Sequential' @hue='slate' />
              {{/if}}
            </div>
          </div>
          <div class='hero-figure'>
            <span class='fig-n'>{{this.roles.length}}</span>
            <span class='fig-u'>approvers</span>
          </div>
        </header>

        <section class='panel'>
          <h2><ScaleIcon role='presentation' />Fires when</h2>
          <p class='cond'>{{describeRule @model}}</p>
          <p class='fine'>Conditions are AND-ed — every populated one must hold.
            To express OR, write a second rule; a rule with nested boolean
            groups is unreadable at exactly the moment someone is working out
            why they were asked to approve something.</p>
        </section>

        <section class='panel'>
          <h2><UsersIcon role='presentation' />Then require</h2>
          {{#if this.roles}}
            <ol class='chain'>
              {{#each this.roles as |r i|}}
                <li class='step'>
                  <span class='step-n'>{{if @model.isParallel 'Any order' i}}</span>
                  <span class='step-who'>{{r}}</span>
                </li>
              {{/each}}
            </ol>
            <p class='fine'>{{if
                @model.isParallel
                'Parallel — none blocks the others, and all must clear before signature.'
                'Sequential — each approver is asked only once the previous has cleared.'
              }}</p>
          {{else}}
            <p class='empty'>No approvers listed. A rule that fires and summons
              nobody blocks a contract with no way forward — add at least one
              role, or deactivate the rule.</p>
          {{/if}}
        </section>

        {{#if @model.guidance}}
          <section class='panel'>
            <h2><ShieldCheckIcon role='presentation' />Guidance</h2>
            <p class='fine is-body'>{{@model.guidance}}</p>
          </section>
        {{/if}}
      </article>

      <style scoped>
        .ar-page {
          container-type: inline-size;
          container-name: ar-page;
          --panel-bg: color-mix(in oklch, var(--foreground, #111) 3%, transparent);
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          color: var(--foreground, #111);
          font-family: var(--font-sans, inherit);
        }
        .hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--boxel-sp-lg);
          border-bottom: 2px solid var(--foreground, #111);
          padding-bottom: var(--boxel-sp);
        }
        .hero-id { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .hero-pills { display: flex; flex-wrap: wrap; gap: 6px; }
        .kicker {
          margin: 0; display: flex; align-items: center; gap: 6px;
          font-size: var(--boxel-font-size-xs); letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--muted-foreground, #6b7280);
        }
        .kicker :deep(svg) { width: max(14px, 1em); height: max(14px, 1em); }
        /* The heading is the one shout. The figure on the right supports it
           and is deliberately smaller — a card is opened for the thing it IS,
           and the number qualifies that rather than replacing it. */
        .hero h1 {
          margin: 0; font-size: var(--boxel-font-size-xl); font-weight: 700;
          line-height: 1.15; letter-spacing: -0.015em;
        }
        .hero-figure { flex: none; text-align: right; line-height: 1; }
        .fig-n {
          display: block; font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums; font-size: 1.45rem; font-weight: 600;
          letter-spacing: -0.03em;
        }
        .fig-u {
          display: block; margin-top: 4px; font-size: var(--boxel-font-size-xs);
          text-transform: uppercase; letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .panel {
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          border-radius: var(--radius, 8px);
          background: var(--panel-bg);
        }
        .panel h2 {
          display: flex; align-items: center; gap: 8px;
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm); font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase;
        }
        .panel h2 :deep(svg) {
          width: max(14px, 1em); height: max(14px, 1em);
          color: var(--muted-foreground, #6b7280);
        }
        .cond {
          margin: 0; font-size: var(--boxel-font-size);
          line-height: 1.55; max-width: 68ch;
        }
        .chain {
          list-style: none; margin: 0; padding: 0;
          display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
          gap: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .step {
          display: flex; flex-direction: column; gap: 2px;
          padding-top: 7px; border-top: 4px solid var(--foreground, #111);
          min-width: 0;
        }
        .step-n {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase;
          color: var(--muted-foreground, #6b7280);
        }
        .step-who {
          font-size: var(--boxel-font-size-sm); font-weight: 620;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fine {
          margin: var(--boxel-sp-xs) 0 0; font-size: var(--boxel-font-size-xs);
          line-height: 1.5; color: var(--muted-foreground, #6b7280);
          max-width: 68ch;
        }
        .fine.is-body {
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, #111);
        }
        .empty {
          margin: 0; font-size: var(--boxel-font-size-sm); line-height: 1.55;
          color: var(--muted-foreground, #6b7280); max-width: 68ch;
        }
        @container ar-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { text-align: left; }
          .chain { grid-template-columns: 1fr; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ApprovalRule> {
    get roleLine(): string {
      let r = (this.args.model?.requiredRoles ?? []).filter(Boolean);
      return r.length ? r.join(' \u2192 ') : 'No approvers';
    }
    <template>
      <article class='fit'>
        <span class='r-head'>
          {{#if @model.isActive}}
            <StatePill @label='Active' @hue='green' @dot={{true}} />
          {{else}}
            <StatePill @label='Inactive' @hue='red' @dot={{true}} />
          {{/if}}
        </span>
        <span class='r-body'>{{@model.cardTitle}}</span>
        <span class='r-meta'>{{this.roleLine}}</span>
      </article>

      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
          overflow: hidden;
          font-family: var(--font-sans, inherit);
          --type-base: clamp(10px, min(calc(3px + 2.1cqi + 1cqb), 10cqb), 15px);
        }
        .r-head, .r-body, .r-meta { overflow: hidden; min-height: 0; }
        .r-body {
          font-size: calc(var(--type-base) * 1.2);
          font-weight: 650;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .r-meta {
          font-size: var(--type-base);
          line-height: 1.25;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @container fitted-card (height <= 65px) { .r-meta { display: none; } }
        @container fitted-card (height <= 45px) { .r-head { display: none; } }
      </style>
    </template>
  };

  /** The rule rendered as the sentence it will be explained with. */
  @field cardDescription = contains(StringField, {
    computeVia: function (this: ApprovalRule) {
      return describeRule(this);
    },
  });
}


/** Human-readable IF half, used both in the rule card and in the approver's banner. */
export function describeRule(r: any): string {
  let parts: string[] = [];
  let types = (r?.appliesToTypes ?? []).filter(Boolean);
  if (types.length) {
    parts.push(`type is ${types.map((t: string) => contractTypeLabel(t)).join(' or ')}`);
  }
  let min = r?.minValue?.amount;
  if (typeof min === 'number') {
    parts.push(`value exceeds ${formatMoney(min, r?.minValue?.currency?.code)}`);
  }
  if (r?.minRiskGrade) {
    parts.push(`risk is ${r.minRiskGrade} or higher`);
  }
  if (typeof r?.minDeviations === 'number' && r.minDeviations > 0) {
    parts.push(`it has ${r.minDeviations} or more clause deviations`);
  }
  if (r?.requiresSensitiveData) {
    parts.push('it handles sensitive personal data');
  }
  if (!parts.length) return 'applies to every contract';
  return parts.join(' and ');
}

/**
 * Does this rule fire for this contract?
 *
 * An unpopulated condition is skipped rather than treated as false — a rule
 * that only sets `minValue` must not silently require a contract type too.
 */
export function ruleMatches(rule: any, subject: RuleSubject): boolean {
  if (rule?.isActive === false) return false;

  let types = (rule?.appliesToTypes ?? []).filter(Boolean);
  if (types.length && !types.includes(subject.contractType ?? '')) return false;

  let min = rule?.minValue?.amount;
  if (typeof min === 'number') {
    let v = subject.value?.amount;
    if (typeof v !== 'number' || v <= min) return false;
  }

  if (rule?.minRiskGrade) {
    let need = RISK_ORDER.indexOf(rule.minRiskGrade);
    let got = RISK_ORDER.indexOf(subject.riskGrade ?? '');
    if (need < 0 || got < 0 || got < need) return false;
  }

  if (typeof rule?.minDeviations === 'number' && rule.minDeviations > 0) {
    if ((subject.deviationCount ?? 0) < rule.minDeviations) return false;
  }

  if (rule?.requiresSensitiveData && !subject.handlesSensitiveData) return false;

  return true;
}

/** Every rule that fires, in priority order, with the chain each demands. */
export function evaluateRules(rules: any[], subject: RuleSubject) {
  return (rules ?? [])
    .filter(Boolean)
    .filter((r) => ruleMatches(r, subject))
    .sort((a, b) => (a?.priority ?? 999) - (b?.priority ?? 999))
    .map((r) => ({
      rule: r,
      name: r?.ruleName ?? 'Untitled rule',
      because: describeRule(r),
      roles: (r?.requiredRoles ?? []).filter(Boolean) as string[],
      isParallel: Boolean(r?.isParallel),
    }));
}
