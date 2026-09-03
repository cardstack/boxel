import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import MarkdownField from '@cardstack/base/markdown';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import ScrollTextIcon from '@cardstack/boxel-icons/scroll-text';
import TriangleAlertIcon from '@cardstack/boxel-icons/triangle-alert';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import ScaleIcon from '@cardstack/boxel-icons/scale';

import { Clause, ClauseTypeField, clauseTypeLabel } from './clause';
import { Contract } from './contract';
import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';
import { tracked } from '@glimmer/tracking';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { EditSectionNav } from './components/edit-section-nav';

/**
 * What THIS contract actually says for one provision, next to what it was
 * supposed to say.
 *
 * DESIGN NOTE — why `deviationSeverity` is stored and `isDeviation` is not.
 *
 * The obvious design computes `isDeviation` by string-comparing `actualText`
 * against the linked standard. Two things break it. First, a link may not be
 * loaded when the computed runs, so the flag would silently flip to "no
 * deviation" for a contract whose standard clause simply had not resolved yet
 * — the worst possible direction for a compliance signal to fail in. Second,
 * and more fundamentally, a diff is not a judgement: reordering a sentence or
 * fixing a typo changes the string without changing the obligation, while one
 * inserted word ("shall" → "shall not") reverses it.
 *
 * So the severity is a lawyer's call, recorded once, and everything else is
 * derived from it locally. No link traversal, nothing to drift.
 */

export const DEVIATION_SEVERITIES = ['none', 'minor', 'major', 'bespoke'];

export const DEVIATION_SEVERITY_LABELS: Record<string, string> = {
  none: 'Standard',
  minor: 'Minor deviation',
  major: 'Major deviation',
  bespoke: 'Bespoke — no standard',
};

export const DEVIATION_SEVERITY_HUE: Record<string, Hue> = {
  none: 'green',
  minor: 'amber',
  major: 'red',
  bespoke: 'purple',
};

export const DeviationSeverityField = enumField(StringField, {
  options: DEVIATION_SEVERITIES.map((value) => ({
    value,
    label: DEVIATION_SEVERITY_LABELS[value],
  })),
  displayName: 'Deviation',
});

/**
 * Severity → the risk this clause contributes, when no standard is linked to
 * inherit from. A bespoke clause with no approved reference is treated as high
 * rather than unknown: language nobody has approved is the definition of an
 * unreviewed exposure.
 */
const SEVERITY_RISK: Record<string, string> = {
  none: 'low',
  minor: 'medium',
  major: 'critical',
  bespoke: 'high',
};

export function deviationLabel(value?: string | null): string {
  return DEVIATION_SEVERITY_LABELS[value ?? ''] ?? 'Not assessed';
}

export class ContractClause extends CardDef {
  static displayName = 'Contract Clause';
  static icon = ScrollTextIcon;

  // Thunked on both sides — Contract links back to its clauses, and a cycle
  // across two modules needs the lazy form at each end or one of them
  // resolves to undefined at load time.
  @field contract = linksTo(() => Contract);
  /** Absent means bespoke language with no approved reference. */
  @field standardClause = linksTo(() => Clause);

  /**
   * Denormalised from the standard on purpose: a bespoke clause has no
   * standard to read a type from, and it still has to be classifiable — a
   * liability clause nobody approved is exactly the one worth finding.
   */
  @field clauseType = contains(ClauseTypeField);
  @field actualText = contains(MarkdownField);

  @field deviationSeverity = contains(DeviationSeverityField);
  /** Why it differs, and who conceded it. Required in practice on major. */
  @field deviationNotes = contains(TextAreaField);

  @field isDeviation = contains(BooleanField, {
    computeVia: function (this: ContractClause) {
      let s = this.deviationSeverity;
      return Boolean(s) && s !== 'none';
    },
  });

  @field riskLevel = contains(StringField, {
    computeVia: function (this: ContractClause) {
      return SEVERITY_RISK[this.deviationSeverity ?? ''] ?? 'low';
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContractClause) {
      return clauseTypeLabel(this.clauseType);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: ContractClause) {
      return deviationLabel(this.deviationSeverity);
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
   * The domain question: "how does this contract's wording differ from the
   * approved standard, and what does that difference cost?"
   *
   * So the deviation is the hero and the two texts sit side by side. A reviewer
   * reads the summary and then checks the diff — which means the summary has to
   * be the thing that is right.
   */
  /**
   * Edit — one clause as it appears in a contract, and how far it departs from the playbook.
   * Grouped by task, not schema order; EditSectionNav is the table of
   * contents (edit-card Rule 0b, family rule: every grouped edit gets the rail).
   */
  static edit = class Edit extends Component<typeof ContractClause> {
    @tracked activeSection = 'context';

    sections = [
      { id: 'context', label: 'Where it sits' },
      { id: 'text', label: 'As agreed' },
      { id: 'deviation', label: 'Deviation' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.cclause-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='cclause-edit'>
        {{! root is the container + only scroller; the responsive grid lives
            on this inner wrapper (edit-card Rule 1 corollary) }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
            <section
              class='sect {{if (eq this.activeSection "context") "focused"}}'
              data-sect='context'
            >
              <h3>Where it sits</h3>
              <FieldContainer @label='Contract' @vertical={{true}}>
                <@fields.contract />
              </FieldContainer>
              <div class='row cols-2'>
                <FieldContainer @label='Library clause it is measured against' @vertical={{true}}>
                  <@fields.standardClause />
                </FieldContainer>
                <FieldContainer @label='Type' @vertical={{true}}>
                  <@fields.clauseType />
                </FieldContainer>
              </div>
            </section>
            <section
              class='sect {{if (eq this.activeSection "text") "focused"}}'
              data-sect='text'
            >
              <h3>As agreed
                <span class='sect-hint'>the words in this contract — compare against the standard text</span></h3>
              <FieldContainer @label='Actual text' @vertical={{true}}>
                <@fields.actualText />
              </FieldContainer>
            </section>
            <section
              class='sect {{if (eq this.activeSection "deviation") "focused"}}'
              data-sect='deviation'
            >
              <h3>Deviation
                <span class='sect-hint'>recorded legal judgment, not a text diff</span></h3>
              <FieldContainer @label='Severity' @vertical={{true}}>
                <@fields.deviationSeverity />
              </FieldContainer>
              <FieldContainer @label='What was conceded, why, and in exchange for what' @vertical={{true}}>
                <@fields.deviationNotes />
              </FieldContainer>
            </section>
          </div>
        </div>
      </div>
      <style scoped>
        .cclause-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* root is the scroller, so sticky pins the rail; the legal family
           asserts no brand ink, so the rail keeps its default fg/bg pair */
        .sect-nav {
          position: sticky;
          top: 0;
        }
        .sects {
          display: grid;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        .sect.focused {
          outline-color: var(--foreground, var(--boxel-dark));
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--foreground, var(--boxel-dark)) 12%, transparent);
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        .hint {
          margin: 0.25rem 0 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .row {
          display: grid;
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .row.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .row.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .row.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        @container edit (width < 640px) {
          .row.cols-2,
          .row.cols-3,
          .row.cols-4 {
            grid-template-columns: 1fr;
          }
          .edit-body {
            grid-template-columns: 1fr;
          }
          .sect-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
          }
          .sect-nav::before {
            display: none;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ContractClause> {
    get hue(): Hue {
      return (
        DEVIATION_SEVERITY_HUE[this.args.model?.deviationSeverity ?? ''] ?? 'slate'
      );
    }
    get isDev() {
      return Boolean(this.args.model?.isDeviation);
    }
    get riskHue(): Hue {
      let r = this.args.model?.riskLevel;
      return r === 'critical' ? 'red' : r === 'high' ? 'orange' : r === 'medium' ? 'amber' : 'green';
    }
    <template>
      <article class='cc-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'><ScrollTextIcon role='presentation' />Contract clause</p>
            <h1>{{@model.cardTitle}}</h1>
            <div class='hero-pills'>
              <StatePill @label={{@model.cardDescription}} @hue={{this.hue}} @dot={{true}} />
              <StatePill @label='{{@model.riskLevel}} risk' @hue={{this.riskHue}} />
            </div>
          </div>
          <div class='hero-figure {{if this.isDev "is-dev"}}'>
            {{#if this.isDev}}
              <TriangleAlertIcon role='presentation' />
              <span class='fig-u'>Departs from standard</span>
            {{else}}
              <span class='fig-u'>Matches standard</span>
            {{/if}}
          </div>
        </header>

        <div class='compare'>
          <section class='panel'>
            <h2><ScaleIcon role='presentation' />This contract says</h2>
            <div class='prose'><@fields.actualText /></div>
          </section>
          <section class='panel'>
            <h2><FileTextIcon role='presentation' />Approved standard</h2>
            {{#if @model.standardClause}}
              <@fields.standardClause @format='embedded' />
            {{else}}
              <p class='empty'>No approved standard is linked. Bespoke language
                nobody has signed off is an unreviewed exposure — link a clause
                from the library, or record why none applies.</p>
            {{/if}}
          </section>
        </div>

        {{#if @model.deviationNotes}}
          <section class='panel note'>
            <h2><TriangleAlertIcon role='presentation' />Why it differs</h2>
            <p class='guidance'>{{@model.deviationNotes}}</p>
          </section>
        {{/if}}
      </article>

      <style scoped>
        .cc-page {
          container-type: inline-size;
          container-name: cc-page;
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
        .hero-figure {
          flex: none; display: flex; flex-direction: column; align-items: flex-end;
          gap: 6px; text-align: right;
        }
        .hero-figure :deep(svg) { width: 34px; height: 34px; }
        .is-dev :deep(svg) { color: var(--boxel-danger, #b3261e); }
        .fig-u {
          font-size: var(--boxel-font-size-xs); text-transform: uppercase;
          letter-spacing: 0.1em; color: var(--muted-foreground, #6b7280);
        }
        .compare {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: var(--boxel-sp);
        }
        .panel {
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          background: var(--panel-bg);
        }
        .note { background: color-mix(in oklch, var(--boxel-warning, #b8860b) 10%, transparent); }
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
          font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
          font-size: var(--boxel-font-size); line-height: 1.6;
        }
        .guidance, .empty {
          margin: 0; font-size: var(--boxel-font-size-sm); line-height: 1.55;
        }
        .empty { color: var(--muted-foreground, #6b7280); }
        @container cc-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { align-items: flex-start; text-align: left; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContractClause> {
    get hue(): Hue {
      return (
        DEVIATION_SEVERITY_HUE[this.args.model?.deviationSeverity ?? ''] ?? 'slate'
      );
    }
    <template>
      <article class='fit'>
        <header class='r-head'>
          <ScrollTextIcon role='presentation' />
          <span class='eyebrow'>Clause</span>
          <span class='head-chip'><StatePill @label={{@model.cardDescription}} @hue={{this.hue}} /></span>
        </header>
        <div class='r-body'>
          <h3 class='anchor'>{{@model.cardTitle}}</h3>
          <p class='sub'>{{@model.deviationNotes}}</p>
        </div>
        <footer class='r-meta'><span class='val'>{{@model.riskLevel}} risk</span></footer>
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

  static atom = class Atom extends Component<typeof ContractClause> {
    get hue(): Hue {
      return (
        DEVIATION_SEVERITY_HUE[this.args.model?.deviationSeverity ?? ''] ??
        'slate'
      );
    }
    <template>
      <span class='cc-atom'>
        <span class='cc-type'>{{@model.cardTitle}}</span>
        <StatePill @label={{@model.cardDescription}} @hue={{this.hue}} />
      </span>
      <style scoped>
        .cc-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
        }
        .cc-type {
          font-weight: 600;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ContractClause> {
    get hue(): Hue {
      return (
        DEVIATION_SEVERITY_HUE[this.args.model?.deviationSeverity ?? ''] ??
        'slate'
      );
    }
    <template>
      <article class='cc-row'>
        <div class='cc-head'>
          <h4 class='cc-name'>{{@model.cardTitle}}</h4>
          <StatePill
            @label={{@model.cardDescription}}
            @hue={{this.hue}}
            @dot={{true}}
          />
        </div>
        {{#if @model.actualText}}
          <div class='cc-text'><@fields.actualText /></div>
        {{/if}}
        {{#if @model.deviationNotes}}
          <p class='cc-notes'>{{@model.deviationNotes}}</p>
        {{/if}}
      </article>
      <style scoped>
        .cc-row {
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
        .cc-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .cc-name {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .cc-head :deep(.state-pill) {
          margin-left: auto;
        }
        .cc-text {
          font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
          font-size: var(--boxel-font-size-sm);
          line-height: 1.55;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .cc-notes {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export default ContractClause;
