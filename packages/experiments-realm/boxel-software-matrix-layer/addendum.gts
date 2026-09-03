import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import DateField from '@cardstack/base/date';
import MarkdownField from '@cardstack/base/markdown';
import enumField from '@cardstack/base/enum';

import { Contract } from './contract';
import { StatePill } from './components/state-pill';
import { formatDay } from './effective-period-field';
import { EditSectionNav } from './components/edit-section-nav';
import FilePlusIcon from '@cardstack/boxel-icons/file-plus';

export const MOD_DOC_STATUSES = ['draft', 'executed'];

export const ModDocStatusField = enumField(StringField, {
  options: MOD_DOC_STATUSES.map((value) => ({ value, label: value })),
  displayName: 'Modification Document Status',
});

// An addendum ADDS terms to an executed contract without altering what was
// already agreed — new scope, an extra schedule, an additional service.
// Contrast with Amendment (changes existing terms) and Waiver (excuses one
// (fitted format added 2026-09-03)
// obligation without changing the text). Keeping the three as distinct
// cards is the domain distinction itself.
export class Addendum extends CardDef {
  static displayName = 'Addendum';
  static headerColor = '#41337a';

  @field contract = linksTo(() => Contract);
  @field name = contains(StringField);
  @field effectiveDate = contains(DateField);
  @field addedTerms = contains(MarkdownField);
  @field status = contains(ModDocStatusField);
  @field executedOn = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Addendum) {
      return this.name?.trim()?.length ? this.name : 'Untitled Addendum';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get effectiveLabel() {
      let d = this.args.model?.effectiveDate;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }
    <template>
      <article class='doc'>
        <header class='head'>
          <div>
            <p class='kicker'>Addendum</p>
            <h1>{{@model.name}}</h1>
            <p class='sub'>effective {{this.effectiveLabel}}</p>
          </div>
          <StatePill
            @label={{if (eqStr @model.status 'executed') 'EXECUTED' 'DRAFT'}}
            @hue={{if (eqStr @model.status 'executed') 'green' 'slate'}}
            @emphatic={{true}}
          />
        </header>
        {{#if @model.contract}}
          <section class='panel'>
            <h2>Supplements Contract</h2>
            <@fields.contract @format='atom' />
          </section>
        {{/if}}
        <section class='panel'>
          <h2>Added Terms</h2>
          {{#if @model.addedTerms}}
            <@fields.addedTerms />
          {{else}}
            <p class='empty'>No terms drafted yet.</p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .doc {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
          display: grid;
          gap: var(--boxel-sp);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.5rem;
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .empty {
          margin: 0;
          font-style: italic;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
        }
      </style>
    </template>
  };

  /**
   * Fitted — attribute-only (prerendered fitted does not resolve links);
   * the Clause fitted's skeleton, so the legal family reads as one set.
   */
  static fitted = class Fitted extends Component<typeof Addendum> {
    get hue() {
      return this.args.model?.status === 'executed' ? ('green' as const) : ('slate' as const);
    }
    <template>
      <article class='fit'>
        <header class='r-head'>
          <FilePlusIcon role='presentation' />
          <span class='eyebrow'>Addendum</span>
          <span class='head-chip'><StatePill @label={{if @model.status @model.status 'draft'}} @hue={{this.hue}} /></span>
        </header>
        <div class='r-body'>
          <h3 class='anchor'>{{@model.cardTitle}}</h3>
          <p class='sub'>{{@model.addedTerms}}</p>
        </div>
        <footer class='r-meta'><span>{{#if @model.effectiveDate}}effective {{formatDay @model.effectiveDate}}{{/if}}</span><span class='val tail'>{{#if @model.executedOn}}executed {{formatDay @model.executedOn}}{{/if}}</span></footer>
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
          margin: 0;
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
          white-space: nowrap;
        }
        .val {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: var(--card-foreground, var(--boxel-dark));
        }
        .tail {
          margin-left: auto;
        }
        @container fitted-card (height <= 50px) {
          .fit { grid-template-rows: auto; }
          .r-body, .r-meta { display: none; }
        }
        @container fitted-card (50px < height <= 80px) {
          .fit { grid-template-rows: auto minmax(0, 1fr); }
          .sub, .r-meta { display: none; }
        }
        @container fitted-card (80px < height <= 130px) {
          .sub, .tail { display: none; }
        }
        @container fitted-card (width <= 150px) {
          .head-chip, .tail { display: none; }
        }
        @container fitted-card (width <= 110px) {
          .eyebrow { display: none; }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='row'>
        <span class='name'>{{@model.name}}</span>
        <StatePill
          @label={{if (eqStr @model.status 'executed') 'executed' 'draft'}}
          @hue={{if (eqStr @model.status 'executed') 'green' 'slate'}}
          @dot={{true}}
        />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.name}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  // Edit grouped the way a reviewer reads a modification document: which
  // contract and when (identity) → what is being added (the substance) →
  // has it been signed (approval). Anchor rail on the left (edit-card
  // Rule 0b). Shares its section shape and class names with Amendment and
  // Waiver so the three modification documents edit as siblings.
  static edit = class Edit extends Component<typeof this> {
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Identity' },
      { id: 'the-change', label: 'The Change' },
      { id: 'approval', label: 'Approval' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.doc-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='doc-edit'>
        {{! root is the container + only scroller; the responsive grid
            lives on this inner wrapper (edit-card Rule 1 corollary) }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
          <section
            class='sect {{if (eq this.activeSection "identity") "focused"}}'
            data-sect='identity'
          >
            <h3>Identity</h3>
            <FieldContainer @label='Supplements contract' @vertical={{true}}>
              <@fields.contract />
            </FieldContainer>
            <div class='row'>
              <FieldContainer @label='Addendum name' @vertical={{true}}>
                <@fields.name />
              </FieldContainer>
              <FieldContainer @label='Effective date' @vertical={{true}}>
                <@fields.effectiveDate />
              </FieldContainer>
            </div>
          </section>

          <section
            class='sect {{if (eq this.activeSection "the-change") "focused"}}'
            data-sect='the-change'
          >
            <h3>The Change
              <span class='sect-hint'>added terms supplement the contract —
                existing text stays untouched</span></h3>
            <FieldContainer @label='Added terms' @vertical={{true}}>
              <@fields.addedTerms />
            </FieldContainer>
          </section>

          <section
            class='sect {{if (eq this.activeSection "approval") "focused"}}'
            data-sect='approval'
          >
            <h3>Approval</h3>
            <div class='row'>
              <FieldContainer @label='Status' @vertical={{true}}>
                <@fields.status />
              </FieldContainer>
              <FieldContainer @label='Executed on' @vertical={{true}}>
                <@fields.executedOn />
              </FieldContainer>
            </div>
          </section>
          </div>
        </div>
      </div>
      <style scoped>
        .doc-edit {
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
        /* the root is the scroller, so sticky pins the nav to its top;
           no ink knobs — the legal family keeps the rail's neutral
           foreground/background default */
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
        /* the section the rail points at mirrors the rail's active state
           in the same neutral ink */
        .sect.focused {
          outline-color: var(--foreground, var(--boxel-dark));
          box-shadow: 0 0 0 4px
            color-mix(
              in oklch,
              var(--foreground, var(--boxel-dark)) 10%,
              transparent
            );
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
        .row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        @container edit (width < 640px) {
          .row {
            grid-template-columns: 1fr;
          }
          /* narrow panel: nav becomes a horizontal chip row above the form */
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
}

function eqStr(a?: string | null, b?: string | null) {
  return a === b;
}
