import {
  Component,
  contains,
  containsMany,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import BriefcaseIcon from '@cardstack/boxel-icons/briefcase';
import { Opportunity, PIPELINE_STAGES } from './opportunity';
import { Contact } from './contact';
import { formatMoney } from './money';

export class Deal extends Opportunity {
  static displayName = 'Deal';
  static icon = BriefcaseIcon;

  @field terms = contains(MarkdownField);
  @field competitors = containsMany(StringField);
  @field decisionMakers = linksToMany(Contact);

  static isolated = class Isolated extends Component<typeof Deal> {
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
      <article class='deal-page'>
        <header class='dh'>
          <div class='dh-id'>
            <p class='doc-kind'>Deal</p>
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
            {{#if @model.competitors.length}}
              <dt>Against</dt>
              <dd>
                {{#each @model.competitors as |c index|}}{{if index ', '}}{{c}}{{/each}}
              </dd>
            {{/if}}
          </dl>
        </section>

        {{#if @model.decisionMakers.length}}
          <section class='panel'>
            <h2>Decision Makers</h2>
            <div class='people'>
              <@fields.decisionMakers @format='embedded' />
            </div>
          </section>
        {{/if}}

        {{#if @model.terms}}
          <section class='panel'>
            <h2>Terms</h2>
            <div class='terms'><@fields.terms /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .deal-page {
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
        .dh {
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
        .people > :deep(.contact + .contact) {
          border-top: 1px solid var(--border, #e5e7eb);
        }
        .terms {
          font-size: 0.875rem;
        }
      </style>
    </template>
  };
}
