import {
  CardDef,
  field,
  contains,
  containsMany,
  linksToMany,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import BooleanField from '@cardstack/base/boolean';
import TextAreaField from '@cardstack/base/text-area';
import MarkdownField from '@cardstack/base/markdown';
import DateField from '@cardstack/base/date';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import ClipboardListIcon from '@cardstack/boxel-icons/clipboard-check';
import ScrollTextIcon from '@cardstack/boxel-icons/scroll-text';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';

import { ContractTypeField, contractTypeLabel } from './contract-type';
import { Clause } from './clause';
import { StatePill } from './components/state-pill';

/**
 * CONTRACT TEMPLATE — the spec's seven standard starting points.
 *
 * WHAT THIS IS NOT. The spec puts document generation explicitly out of scope,
 * so a template here is a *starting position*, not a document factory: which
 * type it is for, which approved clauses it assumes, and the guidance a drafter
 * needs. It does not render a contract.
 *
 * WHAT IS CONSUMED. `Clause` for the standard language — a template that
 * retyped its own clause text would let the library and the templates disagree,
 * which is the drift the clause library exists to prevent.
 */
export class ContractTemplate extends CardDef {
  static displayName = 'Contract Template';
  static icon = FileTextIcon;

  @field templateName = contains(StringField);
  @field contractType = contains(ContractTypeField);
  @field useCase = contains(StringField);
  @field bodyMarkdown = contains(MarkdownField);
  @field guidance = contains(TextAreaField);

  /** Clauses this template assumes. Linked, never copied. */
  @field standardClauses = linksToMany(() => Clause);

  /** Fields a drafter must supply before this can be used. */
  @field requiredInputs = containsMany(StringField);

  /**
   * Published templates are the ones a drafter may pick.
   *
   * Juro's publish/unpublish exists so a standard cannot change under a review
   * that is already running; the same reasoning applies to a template.
   */
  @field isPublished = contains(BooleanField);
  @field lastReviewedAt = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContractTemplate) {
      return this.templateName ?? contractTypeLabel(this.contractType);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: ContractTemplate) {
      return this.useCase ?? '';
    },
  });

  /**
   * The domain question: "can I start from this, and what do I still have to
   * supply?"
   *
   * So the hero is the publish state — an unpublished template is one a drafter
   * must not pick — and the required inputs are the first real section, because
   * that is the work the reader is about to take on.
   */
  static isolated = class Isolated extends Component<typeof ContractTemplate> {
    get inputs(): string[] {
      return (this.args.model?.requiredInputs ?? []).filter(Boolean) as string[];
    }
    get published() {
      return Boolean(this.args.model?.isPublished);
    }
    <template>
      <article class='ct-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'><FileTextIcon role='presentation' />Contract template</p>
            <h1>{{@model.cardTitle}}</h1>
            <div class='hero-pills'>
              {{#if this.published}}
                <StatePill @label='Published' @hue='green' @dot={{true}} />
              {{else}}
                <StatePill @label='Draft — do not use' @hue='amber' @dot={{true}} />
              {{/if}}
              <StatePill @label={{contractTypeLabel @model.contractType}} @hue='slate' />
            </div>
          </div>
          <div class='hero-figure'>
            <span class='fig-n'>{{this.inputs.length}}</span>
            <span class='fig-u'>inputs needed</span>
          </div>
        </header>

        {{#if @model.useCase}}
          <p class='lede'>{{@model.useCase}}</p>
        {{/if}}

        <section class='panel'>
          <h2><ClipboardListIcon role='presentation' />You must supply</h2>
          {{#if this.inputs}}
            <ul class='inputs'>
              {{#each this.inputs as |i|}}<li>{{i}}</li>{{/each}}
            </ul>
          {{else}}
            <p class='empty'>Nothing recorded. A template with no stated inputs
              usually means they live in the drafter's head — write them down.</p>
          {{/if}}
        </section>

        <section class='panel'>
          <h2><ScrollTextIcon role='presentation' />Clauses it assumes</h2>
          {{#if @model.standardClauses.length}}
            <@fields.standardClauses @format='fitted' />
          {{else}}
            <p class='empty'>No clauses linked. The template will still open,
              but nothing connects its language back to the approved library —
              so a change to a standard clause will not reach it.</p>
          {{/if}}
        </section>

        {{#if @model.guidance}}
          <section class='panel'>
            <h2><ShieldCheckIcon role='presentation' />Before you use it</h2>
            <p class='guidance'>{{@model.guidance}}</p>
          </section>
        {{/if}}
      </article>

      <style scoped>
        .ct-page {
          container-type: inline-size;
          container-name: ct-page;
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
        .lede {
          margin: 0; font-size: var(--boxel-font-size); line-height: 1.55;
          max-width: 68ch;
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
        .inputs {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-wrap: wrap; gap: 6px;
        }
        .inputs li {
          font-size: var(--boxel-font-size-sm); font-weight: 600;
          padding: 3px 10px; border-radius: 4px;
          background: color-mix(in oklch, var(--foreground, #111) 7%, transparent);
        }
        .guidance, .empty {
          margin: 0; font-size: var(--boxel-font-size-sm); line-height: 1.55;
          max-width: 68ch;
        }
        .empty { color: var(--muted-foreground, #6b7280); }
        @container ct-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { text-align: left; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContractTemplate> {
    <template>
      <article class='fit'>
        <span class='r-head'>
          {{#if @model.isPublished}}
            <StatePill @label='Published' @hue='green' @dot={{true}} />
          {{else}}
            <StatePill @label='Draft' @hue='slate' @dot={{true}} />
          {{/if}}
        </span>
        <span class='r-body'>{{@model.cardTitle}}</span>
        <span class='r-meta'>{{contractTypeLabel @model.contractType}}</span>
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
}
