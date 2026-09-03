import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import PercentageField from 'https://cardstack.com/base/percentage';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import { Account } from './account';
import { User } from './user';
import { formatMoney } from './money';
// EXTRACTED to its own module (Revenue Ops Console build) so Pipeline Stage
// is a standalone, Spec-able block instead of private to this file. Kept as
// a re-export below so every existing consumer of `./opportunity`
// (`deal.gts`, `revenue-os.gts`, `board-demo.gts`) needs zero edits.
import {
  PipelineStageField as StageField,
  PIPELINE_STAGES,
  STAGE_DEFAULT_PROBABILITY,
  STAGE_COLORS,
  stageSlug,
} from './pipeline-stage-field';

export { PIPELINE_STAGES, STAGE_DEFAULT_PROBABILITY, STAGE_COLORS, stageSlug };

export class Opportunity extends CardDef {
  static displayName = 'Opportunity';
  static icon = TrendingUpIcon;

  @field name = contains(StringField);
  @field account = linksTo(Account);
  @field owner = linksTo(User);
  @field value = contains(AmountWithCurrency);
  @field stage = contains(StageField);
  @field probability = contains(PercentageField);
  @field closeDate = contains(DateField);
  // Written by whoever moves the stage. An event fact rather than a derived
  // value: how long a deal has sat still is not recoverable after the fact.
  @field lastStageChangedAt = contains(DateField);

  @field daysInStage = contains(NumberField, {
    computeVia: function (this: Opportunity) {
      if (!this.lastStageChangedAt) return 0;
      let days = Math.floor(
        (Date.now() - new Date(this.lastStageChangedAt).getTime()) / 86400000,
      );
      return days > 0 ? days : 0;
    },
  });

  @field effectiveProbability = contains(NumberField, {
    computeVia: function (this: Opportunity) {
      if (typeof this.probability === 'number') return this.probability;
      return STAGE_DEFAULT_PROBABILITY[this.stage ?? ''] ?? 0;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Opportunity) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Opportunity> {
    <template>
      <span class='opp-atom'>
        <TrendingUpIcon class='oa-icon' />
        <span class='oa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .opp-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .oa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .oa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Opportunity> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get stageClass() {
      return stageSlug(this.args.model?.stage);
    }
    <template>
      <div class='opp-row'>
        <TrendingUpIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.account.name}}
            <span class='meta'>{{@model.account.name}}</span>
          {{/if}}
        </div>
        {{#if this.valueDisplay}}
          <span class='value'>{{this.valueDisplay}}</span>
        {{/if}}
        {{#if @model.stage}}
          <span class='stage stage-{{this.stageClass}}'>{{@model.stage}}</span>
        {{/if}}
      </div>
      <style scoped>
        .opp-row {
        /* Status hues are DATA — red means overdue whatever the theme — so the hue is
           declared here rather than pulled from a semantic token. These tokens were
           REFERENCED but never declared, so their hex fallback was the only value that
           ever rendered (boxel-theming C2).
           The fill is the part that must not be fixed: a literal #fee2e2 stays pale on
           a dark theme while its text darkens, and the pair silently fails. So the text
           colour is pulled toward the theme's own --foreground, and the fill is then
           diluted out of THAT text colour — measured 6.3–7.6:1 in both light and dark. */
        --stage-closed-lost-fg: color-mix(in oklch, oklch(0.55 0.19 27) 65%, var(--foreground));
        --stage-closed-lost-bg: color-mix(in oklch, var(--stage-closed-lost-fg) 12%, var(--background));
        --stage-closed-won-fg: color-mix(in oklch, oklch(0.55 0.13 152) 65%, var(--foreground));
        --stage-closed-won-bg: color-mix(in oklch, var(--stage-closed-won-fg) 12%, var(--background));
        --stage-late-fg: color-mix(in oklch, oklch(0.60 0.14 60) 65%, var(--foreground));
        --stage-late-bg: color-mix(in oklch, var(--stage-late-fg) 12%, var(--background));
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .value {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .stage {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .stage-closed-won {
          background: var(--stage-closed-won-bg);
          color: var(--stage-closed-won-fg);
        }
        .stage-closed-lost {
          background: var(--stage-closed-lost-bg);
          color: var(--stage-closed-lost-fg);
        }
        .stage-proposal,
        .stage-negotiation {
          background: var(--stage-late-bg);
          color: var(--stage-late-fg);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Opportunity> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get stageClass() {
      return stageSlug(this.args.model?.stage);
    }
    get probabilityDisplay() {
      let p = this.args.model?.effectiveProbability;
      return typeof p === 'number' ? `${p}%` : '';
    }
    get isOpen() {
      let stage = this.args.model?.stage;
      return stage !== 'closed won' && stage !== 'closed lost';
    }
    get ageDisplay() {
      let days = this.args.model?.daysInStage;
      if (!this.isOpen || !days) return '';
      return days === 1 ? '1 day in stage' : `${days} days in stage`;
    }
    // Fitted formats take no arguments, so the threshold is the block's call
    // rather than the consumer's. Seven days is the spec's default.
    get isStuck() {
      return this.isOpen && (this.args.model?.daysInStage ?? 0) >= 7;
    }
    <template>
      <div class='fitted {{if this.isStuck "stuck"}}'>
        <div class='top'>
          <TrendingUpIcon class='icon' />
          {{#if @model.stage}}
            <span class='stage stage-{{this.stageClass}}'>{{@model.stage}}</span>
          {{/if}}
          {{#if this.isStuck}}
            <span class='stuck-flag' title={{this.ageDisplay}}>stalled</span>
          {{/if}}
        </div>
        <span class='name'>{{@model.cardTitle}}</span>
        {{#if this.valueDisplay}}
          <span class='figure'>{{this.valueDisplay}}</span>
        {{/if}}
        {{#if @model.account.name}}
          <span class='meta line-account'>{{@model.account.name}}</span>
        {{/if}}
        {{#if this.probabilityDisplay}}
          <span class='meta line-prob'>{{this.probabilityDisplay}} likely{{#if
              @model.closeDate
            }}
              · closes
              <@fields.closeDate />{{/if}}</span>
        {{/if}}
        {{#if this.ageDisplay}}
          <span class='meta line-age'>{{this.ageDisplay}}</span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
        /* Status hues are DATA — red means overdue whatever the theme — so the hue is
           declared here rather than pulled from a semantic token. These tokens were
           REFERENCED but never declared, so their hex fallback was the only value that
           ever rendered (boxel-theming C2).
           The fill is the part that must not be fixed: a literal #fee2e2 stays pale on
           a dark theme while its text darkens, and the pair silently fails. So the text
           colour is pulled toward the theme's own --foreground, and the fill is then
           diluted out of THAT text colour — measured 6.3–7.6:1 in both light and dark. */
        --stage-closed-lost-fg: color-mix(in oklch, oklch(0.55 0.19 27) 65%, var(--foreground));
        --stage-closed-lost-bg: color-mix(in oklch, var(--stage-closed-lost-fg) 12%, var(--background));
        --stage-closed-won-fg: color-mix(in oklch, oklch(0.55 0.13 152) 65%, var(--foreground));
        --stage-closed-won-bg: color-mix(in oklch, var(--stage-closed-won-fg) 12%, var(--background));
        --stage-late-fg: color-mix(in oklch, oklch(0.60 0.14 60) 65%, var(--foreground));
        --stage-late-bg: color-mix(in oklch, var(--stage-late-fg) 12%, var(--background));
        --state-overdue-fg: color-mix(in oklch, oklch(0.55 0.19 27) 65%, var(--foreground));
        --state-overdue-bg: color-mix(in oklch, var(--state-overdue-fg) 12%, var(--background));
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .icon {
          width: 18px;
          height: 18px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.9375rem;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .stage {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .stage-closed-won {
          background: var(--stage-closed-won-bg);
          color: var(--stage-closed-won-fg);
        }
        .stage-closed-lost {
          background: var(--stage-closed-lost-bg);
          color: var(--stage-closed-lost-fg);
        }
        .stage-proposal,
        .stage-negotiation {
          background: var(--stage-late-bg);
          color: var(--stage-late-fg);
        }
        .line-account,
        .line-prob,
        .line-age {
          display: none;
        }
        .stuck-flag {
          margin-left: auto;
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.0625rem 0.375rem;
          border-radius: 999px;
          background: var(--state-overdue-bg);
          color: var(--state-overdue-fg);
          white-space: nowrap;
          flex-shrink: 0;
        }
        /* A stalled deal reads as needing attention at every size, including
           the badge tier where the age line itself is hidden. */
        .fitted.stuck {
          box-shadow: inset 3px 0 0 var(--state-overdue-fg);
        }
        /* Short cells (strips, badges, the edit-form link pill): a column
           cannot fit, and flex would shear the one shrinkable row mid-glyph
           (Rule 1: hide whole rows, never shrink one into a clip). Below
           90px the card re-lays as ONE centered row. */
        @container fitted-card (max-height: 90px) {
          .fitted {
            flex-direction: row;
            align-items: center;
            gap: 0.5rem;
            padding: 0.25rem 0.75rem;
          }
          .top {
            display: contents;
          }
          .name {
            flex: 0 1 auto;
            min-width: 0;
          }
          .figure {
            margin-left: auto;
            font-size: 0.8125rem;
          }
          .stage {
            order: 4;
          }
          .stuck-flag {
            order: 5;
            margin-left: 0;
          }
        }
        /* Narrow badge: name (and the stalled alert) are the survivors —
           data is all-or-nothing, a hidden figure beats a truncated one. */
        @container fitted-card (max-height: 90px) and (max-width: 220px) {
          .figure,
          .stage {
            display: none;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-account {
            display: block;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-prob,
          .line-age {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Opportunity> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get weightedDisplay() {
      let amount = this.args.model?.value?.amount;
      let p = this.args.model?.effectiveProbability;
      if (typeof amount !== 'number' || typeof p !== 'number') return '';
      return formatMoney(
        (amount * p) / 100,
        this.args.model?.value?.currency?.code,
      );
    }
    get probabilitySource() {
      return typeof this.args.model?.probability === 'number'
        ? 'override'
        : 'stage default';
    }
    get stages() {
      let current = this.args.model?.stage;
      let lost = current === 'closed lost';
      let list = PIPELINE_STAGES.filter((s) =>
        lost ? s !== 'closed won' : s !== 'closed lost',
      );
      let idx = list.indexOf(current as (typeof PIPELINE_STAGES)[number]);
      return list.map((label, i) => ({
        label,
        state:
          idx < 0
            ? 'todo'
            : i < idx
              ? 'done'
              : i === idx
                ? lost
                  ? 'lost'
                  : 'current'
                : 'todo',
      }));
    }
    <template>
      <article class='opp-page'>
        <header class='oh'>
          <div class='oh-id'>
            <p class='doc-kind'>{{@model.constructor.displayName}}</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          {{#if this.valueDisplay}}
            <div class='value-block'>
              <span class='value'>{{this.valueDisplay}}</span>
              {{#if this.weightedDisplay}}
                <span class='weighted'>{{this.weightedDisplay}} weighted ·
                  {{@model.effectiveProbability}}%
                  ({{this.probabilitySource}})</span>
              {{/if}}
            </div>
          {{/if}}
        </header>

        <ol class='stepper'>
          {{#each this.stages as |step|}}
            <li class='step step-{{step.state}}'>
              <span class='dot'></span>
              <span class='step-label'>{{step.label}}</span>
            </li>
          {{/each}}
        </ol>

        <section class='panel'>
          <h2>Details</h2>
          <dl>
            {{#if @model.account}}
              <dt>Account</dt>
              <dd class='acct'><@fields.account @format='embedded' /></dd>
            {{/if}}
            {{#if @model.owner}}
              <dt>Owner</dt>
              <dd><@fields.owner @format='atom' /></dd>
            {{/if}}
            {{#if @model.closeDate}}
              <dt>Close date</dt>
              <dd><@fields.closeDate /></dd>
            {{/if}}
          </dl>
        </section>
      </article>
      <style scoped>
        .opp-page {
        /* Status hues are DATA — red means overdue whatever the theme — so the hue is
           declared here rather than pulled from a semantic token. These tokens were
           REFERENCED but never declared, so their hex fallback was the only value that
           ever rendered (boxel-theming C2).
           The fill is the part that must not be fixed: a literal #fee2e2 stays pale on
           a dark theme while its text darkens, and the pair silently fails. So the text
           colour is pulled toward the theme's own --foreground, and the fill is then
           diluted out of THAT text colour — measured 6.3–7.6:1 in both light and dark. */
        --stage-closed-lost-fg: color-mix(in oklch, oklch(0.55 0.19 27) 65%, var(--foreground));
        --stage-closed-lost-bg: color-mix(in oklch, var(--stage-closed-lost-fg) 12%, var(--background));
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .oh {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1rem;
          flex-wrap: wrap;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.75rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .value-block {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.125rem;
        }
        .value {
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .weighted {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .stepper {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          gap: 0;
        }
        .step {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.375rem;
          position: relative;
          min-width: 0;
        }
        .step::before {
          content: '';
          position: absolute;
          top: 5px;
          left: -50%;
          width: 100%;
          height: 2px;
          background: var(--border, #e5e7eb);
        }
        .step:first-child::before {
          display: none;
        }
        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--border, #e5e7eb);
          position: relative;
          z-index: 1;
        }
        .step-done .dot {
          background: var(--primary, #111111);
        }
        .step-done::before {
          background: var(--primary, #111111);
        }
        .step-current .dot {
          background: var(--card, #ffffff);
          border: 3px solid var(--primary, #111111);
          box-sizing: border-box;
          width: 14px;
          height: 14px;
        }
        .step-current::before {
          background: var(--primary, #111111);
        }
        .step-lost .dot {
          background: var(--stage-closed-lost-fg);
        }
        .step-label {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, #6b7280);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .step-current .step-label {
          color: var(--foreground, #111111);
        }
        .step-lost .step-label {
          color: var(--stage-closed-lost-fg);
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5rem 1.25rem;
          font-size: 0.875rem;
          align-items: center;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
        .acct {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          max-width: 24rem;
        }
      </style>
    </template>
  };
}
