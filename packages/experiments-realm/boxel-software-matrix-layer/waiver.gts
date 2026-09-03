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
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';

import { Contract } from './contract';
import { LegalEntity } from './legal-entity';
import { StatePill } from './components/state-pill';
import { formatDay } from './effective-period-field';
import { EditSectionNav } from './components/edit-section-nav';
import HandStopIcon from '@cardstack/boxel-icons/hand-stop';

export const WAIVER_SCOPES = ['one-time', 'ongoing'];

export const WaiverScopeField = enumField(StringField, {
  options: WAIVER_SCOPES.map((value) => ({ value, label: value })),
  displayName: 'Waiver Scope',
});

// A waiver EXCUSES one obligation without changing the contract's text —
// "we will not enforce the late fee for the March invoice." The scope
// distinction is the legally dangerous part and is therefore a first-class
// field: a one-time waiver expires with its occasion; an ongoing one can be
// read as abandoning the right, which is why real waivers name an expiry.
// Contrast with Amendment (changes terms) and Addendum (adds terms).
export class Waiver extends CardDef {
  static displayName = 'Waiver';
  static headerColor = '#41337a';

  @field contract = linksTo(() => Contract);
  @field grantedTo = linksTo(() => LegalEntity);
  @field provisionWaived = contains(StringField, {
    description: 'Which section/obligation is being waived',
  });
  @field scope = contains(WaiverScopeField);
  @field effectiveDate = contains(DateField);
  @field expiresOn = contains(DateField);
  @field reason = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Waiver) {
      return this.provisionWaived?.trim()?.length
        ? `Waiver — ${this.provisionWaived}`
        : 'Waiver';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get windowLabel() {
      let from = this.args.model?.effectiveDate;
      let to = this.args.model?.expiresOn;
      let fmt = (d: Date) =>
        d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      if (from && to) {
        return `${fmt(from)} → ${fmt(to)}`;
      }
      if (from) {
        return `from ${fmt(from)}`;
      }
      return '—';
    }
    <template>
      <article class='doc'>
        <header class='head'>
          <div>
            <p class='kicker'>Waiver</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='sub'>{{this.windowLabel}}</p>
          </div>
          <StatePill
            @label='{{@model.scope}}'
            @hue={{if (isOngoing @model.scope) 'amber' 'slate'}}
            @emphatic={{true}}
          />
        </header>
        <div class='grid'>
          {{#if @model.contract}}
            <section class='panel'>
              <h2>Under Contract</h2>
              <@fields.contract @format='atom' />
            </section>
          {{/if}}
          {{#if @model.grantedTo}}
            <section class='panel'>
              <h2>Granted To</h2>
              <@fields.grantedTo @format='atom' />
            </section>
          {{/if}}
        </div>
        {{#if @model.reason}}
          <section class='panel'>
            <h2>Reason</h2>
            <p class='reason'>{{@model.reason}}</p>
          </section>
        {{/if}}
        {{#if (isOngoing @model.scope)}}
          <p class='caution'>⚠ Ongoing waiver — without an expiry this can
            read as abandoning the right entirely.</p>
        {{/if}}
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
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
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
        .reason {
          margin: 0;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
        .caution {
          margin: 0;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: color-mix(
            in oklch,
            var(--state-amber-fg, #b45309) 10%,
            transparent
          );
          color: var(--state-amber-fg, #b45309);
          font-size: 0.875rem;
        }
        @container (max-width: 480px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  /**
   * Fitted — attribute-only (prerendered fitted does not resolve links);
   * the Clause fitted's skeleton, so the legal family reads as one set.
   */
  static fitted = class Fitted extends Component<typeof Waiver> {
    get hue() {
      return this.args.model?.scope === 'ongoing' ? ('amber' as const) : ('slate' as const);
    }
    <template>
      <article class='fit'>
        <header class='r-head'>
          <HandStopIcon role='presentation' />
          <span class='eyebrow'>Waiver</span>
          <span class='head-chip'><StatePill @label={{if @model.scope @model.scope 'one-time'}} @hue={{this.hue}} /></span>
        </header>
        <div class='r-body'>
          <h3 class='anchor'>{{@model.cardTitle}}</h3>
          <p class='sub'>{{@model.reason}}</p>
        </div>
        <footer class='r-meta'><span>{{#if @model.effectiveDate}}from {{formatDay @model.effectiveDate}}{{/if}}</span><span class='val tail'>{{#if @model.expiresOn}}until {{formatDay @model.expiresOn}}{{/if}}</span></footer>
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
        <span class='name'>{{@model.provisionWaived}}</span>
        <StatePill
          @label='{{@model.scope}}'
          @hue={{if (isOngoing @model.scope) 'amber' 'slate'}}
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
      <span class='atom'>{{@model.cardTitle}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  // Edit grouped the way a reviewer reads a modification document: which
  // contract, who benefits, and which obligation (identity) → what is being
  // excused and for how long (the substance). A waiver has no execution
  // workflow fields, so no Approval section. Anchor rail on the left
  // (edit-card Rule 0b). Shares its section shape and class names with
  // Amendment and Addendum so the three modification documents edit as
  // siblings.
  static edit = class Edit extends Component<typeof this> {
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Identity' },
      { id: 'the-change', label: 'The Change' },
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
            <div class='row'>
              <FieldContainer @label='Under contract' @vertical={{true}}>
                <@fields.contract />
              </FieldContainer>
              <FieldContainer @label='Granted to' @vertical={{true}}>
                <@fields.grantedTo />
              </FieldContainer>
            </div>
            <FieldContainer
              @label='Provision waived (which section / obligation)'
              @vertical={{true}}
            >
              <@fields.provisionWaived />
            </FieldContainer>
          </section>

          <section
            class='sect {{if (eq this.activeSection "the-change") "focused"}}'
            data-sect='the-change'
          >
            <h3>The Change
              <span class='sect-hint'>an ongoing waiver without an expiry can
                read as abandoning the right entirely</span></h3>
            <div class='row three'>
              <FieldContainer @label='Scope' @vertical={{true}}>
                <@fields.scope />
              </FieldContainer>
              <FieldContainer @label='Effective date' @vertical={{true}}>
                <@fields.effectiveDate />
              </FieldContainer>
              <FieldContainer @label='Expires on' @vertical={{true}}>
                <@fields.expiresOn />
              </FieldContainer>
            </div>
            <FieldContainer @label='Reason' @vertical={{true}}>
              <@fields.reason />
            </FieldContainer>
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
        .row.three {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        @container edit (width < 640px) {
          .row,
          .row.three {
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

function isOngoing(scope?: string | null) {
  return scope === 'ongoing';
}
