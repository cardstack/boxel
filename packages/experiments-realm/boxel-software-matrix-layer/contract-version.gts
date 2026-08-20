import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import UrlField from '@cardstack/base/url';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import ScrollTextIcon from '@cardstack/boxel-icons/scroll-text';
import HistoryIcon from '@cardstack/boxel-icons/history';
import FileTextIcon from '@cardstack/boxel-icons/file-text';

import { Employee } from './employee';
import { Contract } from './contract';
import { StatePill } from './components/state-pill';
import { formatMoney } from './money';
import { formatDay } from './format';

/**
 * CONTRACT VERSION — an amendment record, so "version history" is a history
 * rather than a lineage.
 *
 * WHAT WAS THERE BEFORE. `Contract.parentContract` gives the chain from an
 * amendment back to its master, which answers "what is this an amendment TO".
 * It does not answer "what CHANGED, when, and who signed it" — and that second
 * question is the one an auditor and a renewal reviewer both actually ask.
 *
 * WHY THE CHANGED VALUES ARE STORED, not derived. Reading the current contract
 * tells you where things ended up; it cannot tell you what the value was before
 * amendment 2, because the contract has since been edited. A version record
 * that recomputed from the live card would show today's numbers on every row
 * and quietly claim nothing ever changed.
 */
export class ContractVersion extends CardDef {
  static displayName = 'Contract Version';
  static icon = ScrollTextIcon;

  /** A real link, so a reader can open the contract this version belongs to. */
  @field contract = linksTo(() => Contract);

  /** The title as at this version — a snapshot, not a read-through. */
  @field contractTitle = contains(StringField);

  @field versionNumber = contains(NumberField);
  @field effectiveDate = contains(DateField);
  @field executedBy = linksTo(() => Employee);
  @field documentUrl = contains(UrlField);

  /** What this version changed, in the drafter's words. */
  @field summary = contains(TextAreaField);

  /** Values AS AT this version — snapshots, never recomputed. */
  @field valueAtVersion = contains(AmountWithCurrency);
  @field endDateAtVersion = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContractVersion) {
      let n = this.versionNumber;
      let label = n === 1 ? 'Original' : `Amendment ${(n ?? 1) - 1}`;
      return this.contractTitle ? `${this.contractTitle} — ${label}` : label;
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: ContractVersion) {
      return this.summary ?? '';
    },
  });

  /**
   * The domain question: "what did this version change, and what were the
   * numbers at the time?"
   *
   * The value AS AT this version is the hero, because it is the figure a reader
   * came for and the one they cannot get from the live contract — the contract
   * has since been edited and only shows today.
   */
  static isolated = class Isolated extends Component<typeof ContractVersion> {
    get money(): string {
      return (
        formatMoney(
          this.args.model?.valueAtVersion?.amount,
          this.args.model?.valueAtVersion?.currency?.code,
        ) || '—'
      );
    }
    get isOriginal() {
      return (this.args.model?.versionNumber ?? 1) === 1;
    }
    <template>
      <article class='cv-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'><ScrollTextIcon role='presentation' />Contract version</p>
            <h1>{{@model.cardTitle}}</h1>
            <div class='hero-pills'>
              <StatePill
                @label='v{{if @model.versionNumber @model.versionNumber 1}}'
                @hue='blue'
              />
              {{#if this.isOriginal}}
                <StatePill @label='Original' @hue='slate' />
              {{else}}
                <StatePill @label='Amendment' @hue='amber' />
              {{/if}}
            </div>
          </div>
          <div class='hero-figure'>
            <span class='fig-n'>{{this.money}}</span>
            <span class='fig-u'>value at this version</span>
          </div>
        </header>

        <dl class='glance'>
          <div><dt>Effective</dt><dd>{{formatDay @model.effectiveDate}}</dd></div>
          <div><dt>Term ends</dt><dd>{{formatDay @model.endDateAtVersion}}</dd></div>
          <div><dt>Executed by</dt><dd>{{if @model.executedBy @model.executedBy.cardTitle '—'}}</dd></div>
        </dl>

        <section class='panel'>
          <h2><HistoryIcon role='presentation' />What changed</h2>
          {{#if @model.summary}}
            <p class='prose'>{{@model.summary}}</p>
          {{else}}
            <p class='empty'>No summary recorded. A version with no stated change
              is a date and a number — the next reader has to diff it by eye.</p>
          {{/if}}
        </section>

        {{#if @model.documentUrl}}
          <section class='panel'>
            <h2><FileTextIcon role='presentation' />Executed copy</h2>
            <a
              class='doc'
              href={{@model.documentUrl}}
              target='_blank'
              rel='noopener noreferrer'
            >Open the signed document</a>
          </section>
        {{/if}}

        <p class='caveat'>These values are snapshots taken when the version was
          recorded, not readings from the live contract. That is the point: the
          contract shows today, and this shows what was agreed then.</p>
      </article>

      <style scoped>
        .cv-page {
          container-type: inline-size;
          container-name: cv-page;
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
          display: flex; align-items: flex-start; justify-content: space-between;
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
        .hero-figure { flex: 0 1 auto; min-width: 0; text-align: right; line-height: 1; }
        /* Money keeps its minor units and never wraps — a truncated amount on a
           version record is unusable evidence. */
        .fig-n {
          display: block; font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums; font-size: 1.45rem; font-weight: 600;
          letter-spacing: -0.03em; white-space: nowrap;
        }
        .fig-u {
          display: block; margin-top: 4px; font-size: var(--boxel-font-size-xs);
          text-transform: uppercase; letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .glance {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
          gap: var(--boxel-sp); margin: 0;
        }
        .glance div { min-width: 0; }
        .glance dt {
          font-size: var(--boxel-font-size-xs); letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--muted-foreground, #6b7280);
        }
        .glance dd {
          margin: 3px 0 0; font-size: var(--boxel-font-size); font-weight: 550;
          font-family: var(--font-mono, ui-monospace, monospace);
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
        .prose {
          margin: 0;
          font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
          font-size: var(--boxel-font-size); line-height: 1.6; max-width: 68ch;
        }
        .empty, .caveat {
          margin: 0; font-size: var(--boxel-font-size-sm); line-height: 1.5;
          color: var(--muted-foreground, #6b7280); max-width: 68ch;
        }
        .caveat { font-size: var(--boxel-font-size-xs); }
        .doc { font-size: var(--boxel-font-size-sm); }
        @container cv-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { text-align: left; }
          .fig-n { font-size: 2rem; }
          .glance { grid-template-columns: 1fr; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContractVersion> {
    get money(): string {
      return formatMoney(
        this.args.model?.valueAtVersion?.amount,
        this.args.model?.valueAtVersion?.currency?.code,
      );
    }
    <template>
      <article class='fit'>
        <span class='r-head'>
          <StatePill
            @label='v{{if @model.versionNumber @model.versionNumber 1}}'
            @hue='blue'
          />
        </span>
        <span class='r-body'>{{if @model.summary @model.summary 'No summary recorded'}}</span>
        {{#if this.money}}<span class='r-meta'>{{this.money}}</span>{{/if}}
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
          font-size: calc(var(--type-base) * 1.1);
          font-weight: 600;
          line-height: 1.25;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        /* Money never ellipsises — a truncated amount is not an amount. */
        .r-meta {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: var(--type-base);
          white-space: nowrap;
          color: var(--muted-foreground, #6b7280);
        }
        @container fitted-card (height <= 65px) { .r-meta { display: none; } }
        @container fitted-card (height <= 45px) { .r-head { display: none; } }
      </style>
    </template>
  };
}
