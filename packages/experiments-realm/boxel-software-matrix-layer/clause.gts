import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import MarkdownField from '@cardstack/base/markdown';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import GavelIcon from '@cardstack/boxel-icons/gavel';
import HistoryIcon from '@cardstack/boxel-icons/history';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';
import { realmURL } from '@cardstack/base/card-api';
import { codeRef, type getCards } from '@cardstack/runtime-common';
import type Owner from '@ember/owner';

import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';

/**
 * A pre-approved piece of contract language, owned by legal.
 *
 * This is the reference every ContractClause is measured against — it is what
 * turns "this wording looks unusual" into "this departs from the approved
 * liability cap, and here is the approved cap". Without a library there is no
 * such thing as a deviation, only an opinion.
 *
 * A Clause is NOT a contract term: it has no parties, no dates and no value.
 * It is a template fragment. The instance that appears in a signed agreement
 * is `ContractClause` (contract-clause.gts), which links back here.
 */

export const CLAUSE_TYPES = [
  'payment',
  'liability',
  'indemnification',
  'termination',
  'confidentiality',
  'data_protection',
  'force_majeure',
  'auto_renewal',
  'other',
];

export const CLAUSE_TYPE_LABELS: Record<string, string> = {
  payment: 'Payment terms',
  liability: 'Liability',
  indemnification: 'Indemnification',
  termination: 'Termination',
  confidentiality: 'Confidentiality',
  data_protection: 'Data protection',
  force_majeure: 'Force majeure',
  auto_renewal: 'Auto-renewal',
  other: 'Other',
};

export const ClauseTypeField = enumField(StringField, {
  options: CLAUSE_TYPES.map((value) => ({
    value,
    label: CLAUSE_TYPE_LABELS[value],
  })),
  displayName: 'Clause Type',
  icon: FileTextIcon,
});

/**
 * The risk a clause carries when used as written.
 *
 * Deliberately the same four grades as `RiskRatingField` (contract-risk.gts),
 * because a reader who has learned the contract palette should not have to
 * learn a second one for clauses. The vocabulary is shared; the arithmetic is
 * not — a clause's level is a legal judgement, a contract's grade is computed.
 */
export const CLAUSE_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

export const CLAUSE_RISK_HUE: Record<string, Hue> = {
  low: 'green',
  medium: 'amber',
  high: 'orange',
  critical: 'red',
};

export const ClauseRiskField = enumField(StringField, {
  options: CLAUSE_RISK_LEVELS.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
  displayName: 'Clause Risk',
});

// @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
const here: string = import.meta.url;
/**
 * Built with `codeRef` rather than importing ContractClause: a static import
 * here would be a module cycle (contract-clause imports this file for
 * ClauseTypeField), and a thunk does not help because the cycle is at module
 * EVALUATION time, not at field-reference time.
 */
const CONTRACT_CLAUSE_REF = codeRef(here, './contract-clause', 'ContractClause');

export function clauseTypeLabel(value?: string | null): string {
  return CLAUSE_TYPE_LABELS[value ?? ''] ?? value ?? '—';
}

export class Clause extends CardDef {
  static displayName = 'Clause';
  static icon = FileTextIcon;

  @field name = contains(StringField);
  @field clauseType = contains(ClauseTypeField);
  @field standardText = contains(MarkdownField);
  @field riskLevel = contains(ClauseRiskField);
  /** When to use it, and what must never be conceded without sign-off. */
  @field guidance = contains(TextAreaField);
  /** Which role may edit the approved text. */
  @field ownerRole = contains(StringField);
  /**
   * Approved language goes stale. A clause last reviewed before a regulation
   * changed is its own risk, so the date is a first-class field rather than
   * metadata.
   */
  @field reviewedAt = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Clause) {
      return this.name?.trim()?.length ? this.name : 'Untitled clause';
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: Clause) {
      return clauseTypeLabel(this.clauseType);
    },
  });


  /**
   * ATTRIBUTE-ONLY, deliberately.
   *
   * Prerendered fitted does not resolve `linksTo`, so a fitted that reaches for
   * a linked card renders as "Card Error" in any grid — the exact failure this
   * card would have hit without a fitted of its own, falling back to CardDef's
   * default. Everything below is a plain attribute or a computed string.
   *
   * The type scale is capped against `cqb` on `--type-base` itself rather than
   * per-role: in a wide+short cell the `cqi` term dominates and per-role `cqb`
   * caps never bind, which is how a headline outgrows its row and gets sheared.
   */

  /**
   * The domain question: "is this language safe to use, and where is it already
   * in force?"
   *
   * The second half is a REVERSE query — ContractClause links up to Clause, so
   * usage is not a field on this card and cannot be. Without it a reader can
   * see the approved text but not whether changing it would disturb 40 live
   * contracts, which is the thing that actually decides the edit.
   */
  static isolated = class Isolated extends Component<typeof Clause> {
    private usageQuery: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      this.usageQuery = this.args.context?.getCards(
        this,
        () => {
          let id = this.args.model?.id;
          if (!id) return undefined;
          return {
            filter: {
              on: CONTRACT_CLAUSE_REF,
              every: [{ eq: { 'standardClause.id': id } }],
            },
          };
        },
        () => this.realms,
        { isLive: true },
      );
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    get usages(): any[] {
      return ((this.usageQuery as any)?.instances ?? []).filter(Boolean);
    }
    // A live query resolving after first paint is how a card asserts "used
    // nowhere" about data it has not received.
    get isCounting() {
      let q = this.usageQuery as any;
      return Boolean(q?.isLoading) && !this.usages.length;
    }
    // Without reading errors, a failed lookup is indistinguishable from zero.
    get lookupFailed() {
      return Boolean(((this.usageQuery as any)?.errors ?? []).length);
    }
    get deviations() {
      return this.usages.filter((u) => u.isDeviation);
    }
    get hue(): Hue {
      return CLAUSE_RISK_HUE[this.args.model?.riskLevel ?? ''] ?? 'slate';
    }
    /** Approved language that has not been re-read in over a year is its own risk. */
    get staleness(): string | undefined {
      let d = this.args.model?.reviewedAt;
      if (!d) return 'never reviewed';
      let months = Math.floor(
        (Date.now() - new Date(d).getTime()) / (30 * 86_400_000),
      );
      return months >= 12 ? `${Math.floor(months / 12)}y since review` : undefined;
    }

    <template>
      <article class='cl-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'><GavelIcon role='presentation' />{{@model.cardDescription}}</p>
            <h1>{{@model.cardTitle}}</h1>
            <div class='hero-pills'>
              <StatePill @label={{@model.riskLevel}} @hue={{this.hue}} @dot={{true}} />
              {{#if this.staleness}}
                <StatePill @label={{this.staleness}} @hue='amber' />
              {{/if}}
            </div>
          </div>
          <div class='hero-figure'>
            <span class='fig-n'>{{this.usages.length}}</span>
            <span class='fig-u'>in force</span>
          </div>
        </header>

        <section class='panel prose-panel'>
          <h2><FileTextIcon role='presentation' />Approved language</h2>
          <div class='prose'><@fields.standardText /></div>
        </section>

        {{#if @model.guidance}}
          <section class='panel'>
            <h2><ShieldCheckIcon role='presentation' />When to use it</h2>
            <p class='guidance'>{{@model.guidance}}</p>
          </section>
        {{/if}}

        <section class='panel'>
          <h2><HistoryIcon role='presentation' />Where it is used
            {{#if this.deviations.length}}
              <span class='warn'>{{this.deviations.length}} deviating</span>
            {{/if}}
          </h2>
          {{#if this.lookupFailed}}
            <p class='empty' role='status'>Could not look up where this clause is
              used. This is a failed query, not an unused clause — reload before
              concluding it is safe to change.</p>
          {{else if this.isCounting}}
            <p class='empty' role='status'>Counting contracts…</p>
          {{else if this.usages.length}}
            <ul class='uses'>
              {{#each this.usages as |u|}}
                <li>{{u.cardTitle}}
                  <span class='use-note'>{{u.cardDescription}}</span></li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>Not yet used in any contract. Safe to revise.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .cl-page {
          container-type: inline-size;
          container-name: cl-page;
          --panel-bg: color-mix(in oklch, var(--foreground, #111) 3%, transparent);
          --panel-pad: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          --panel-radius: var(--radius, 8px);
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
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
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
        .warn {
          margin-left: auto; color: var(--boxel-danger, #b3261e);
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        /* Legal prose gets a serif and a real measure — it is read, not scanned. */
        .prose {
          font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
          font-size: var(--boxel-font-size);
          line-height: 1.6;
          max-width: 68ch;
        }
        .guidance {
          margin: 0; font-size: var(--boxel-font-size-sm);
          line-height: 1.55; max-width: 68ch;
        }
        .uses { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .uses li {
          display: flex; align-items: baseline; gap: 8px;
          font-size: var(--boxel-font-size-sm);
          padding: 4px 0; border-bottom: 1px solid var(--border, #e5e7eb);
        }
        .uses li:last-child { border-bottom: 0; }
        .use-note { margin-left: auto; color: var(--muted-foreground, #6b7280); }
        .empty {
          margin: 0; font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, #6b7280); line-height: 1.5;
        }
        @container cl-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { text-align: left; }
          .fig-n { font-size: 2.4rem; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Clause> {
    get hue(): Hue {
      return CLAUSE_RISK_HUE[this.args.model?.riskLevel ?? ''] ?? 'slate';
    }
    <template>
      <article class='fit'>
        <header class='r-head'>
          <FileTextIcon role='presentation' />
          <span class='eyebrow'>{{@model.cardDescription}}</span>
          <span class='head-chip'><StatePill @label={{@model.riskLevel}} @hue={{this.hue}} /></span>
        </header>
        <div class='r-body'>
          <h3 class='anchor'>{{@model.cardTitle}}</h3>
          <p class='sub'>{{@model.guidance}}</p>
        </div>
        <footer class='r-meta'><span>{{@model.ownerRole}}</span><span class='val tail'>{{@model.reviewedAt}}</span></footer>
      </article>
      <style scoped>
        .fit {
          --type-ratio: 1.24;
          --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb));
          --type-base: clamp(
            10px,
            min(calc(3px + 2.1cqi + 1cqb - 0.6 * var(--ar)), 10cqb),
            17px
          );
          --meta-size: max(10px, calc(var(--type-base) / var(--type-ratio)));
          --anchor-size: max(
            11px,
            min(calc(var(--type-base) * var(--type-ratio) * var(--type-ratio)), 26cqb)
          );
          --glyph: max(11px, min(3cqi, 14cqb));
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);

          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .r-head > :deep(svg) {
          width: var(--glyph);
          height: var(--glyph);
          flex: none;
          color: var(--accent, var(--boxel-highlight));
        }
        .eyebrow {
          font-size: max(9px, calc(var(--meta-size) * 0.85));
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .head-chip {
          margin-left: auto;
          flex: none;
        }
        .r-body {
          display: grid;
          align-content: start;
          gap: 2px;
        }
        /* The anchor: loudest thing at every size, and the only survivor at badge. */
        .anchor {
          margin: 0;
          font-size: var(--anchor-size);
          font-weight: 700;
          line-height: 1.18;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .sub {
          font-size: var(--meta-size);
          line-height: 1.3;
          color: var(--muted-foreground, var(--boxel-450));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .r-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: var(--meta-size);
          line-height: 1.3;
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* Values are all-or-nothing: hidden at a quantum, never ellipsised. */
        .val {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: var(--card-foreground, var(--boxel-dark));
          white-space: nowrap;
        }
        .tail {
          margin-left: auto;
          white-space: nowrap;
        }

        /* Badge: anchor only. */
        @container fitted-card (height <= 50px) {
          .fit { grid-template-rows: auto; }
          .r-body, .r-meta { display: none; }
        }
        /* Strip: anchor + meta, no body detail. */
        @container fitted-card (50px < height <= 80px) {
          .fit { grid-template-rows: auto minmax(0, 1fr); }
          .sub { display: none; }
          .r-meta { display: none; }
        }
        /* Thin tile: meta returns, secondary line still out. */
        @container fitted-card (80px < height <= 130px) {
          .sub { display: none; }
          .tail { display: none; }
        }
        @container fitted-card (width <= 150px) {
          .head-chip { display: none; }
          .tail { display: none; }
        }
        @container fitted-card (width <= 110px) {
          .eyebrow { display: none; }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Clause> {
    get hue(): Hue {
      return CLAUSE_RISK_HUE[this.args.model?.riskLevel ?? ''] ?? 'slate';
    }
    <template>
      <span class='clause-atom'>
        <FileTextIcon class='cl-icon' role='presentation' />
        <span class='cl-name'>{{@model.cardTitle}}</span>
        <StatePill @label={{@model.riskLevel}} @hue={{this.hue}} />
      </span>
      <style scoped>
        .clause-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
          max-width: 100%;
        }
        .cl-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .cl-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Clause> {
    get hue(): Hue {
      return CLAUSE_RISK_HUE[this.args.model?.riskLevel ?? ''] ?? 'slate';
    }
    <template>
      <article class='clause-emb'>
        <header class='ce-head'>
          <h3 class='ce-name'>{{@model.cardTitle}}</h3>
          <StatePill
            @label={{@model.riskLevel}}
            @hue={{this.hue}}
            @dot={{true}}
          />
        </header>
        <p class='ce-type'>{{@model.cardDescription}}</p>
        {{#if @model.standardText}}
          <div class='ce-text'><@fields.standardText /></div>
        {{/if}}
      </article>
      <style scoped>
        .clause-emb {
        /* The host wraps a linked card in a CardContainer that draws a
           boundary and deliberately adds NO padding (base/field-component.gts),
           because padding there would shift the container-query breakpoints the
           inner card reasons about. So the inset has to come from here, or the
           text sits flush against the pill the host draws. */
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxxs);
        }
        .ce-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .ce-name {
          margin: 0;
          font-size: var(--boxel-font-size);
          font-weight: 600;
          line-height: 1.2;
        }
        .ce-head :deep(.state-pill) {
          margin-left: auto;
        }
        .ce-type {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* Legal prose, not UI copy — it gets a serif and room to breathe, and
           it is clamped rather than ellipsised so the reader can see it is a
           paragraph and not a truncated label. */
        .ce-text {
          font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
          font-size: var(--boxel-font-size-sm);
          line-height: 1.55;
          color: var(--card-foreground, var(--boxel-dark));
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      </style>
    </template>
  };
}

export default Clause;
