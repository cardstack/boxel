import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import enumField from 'https://cardstack.com/base/enum';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';

const LaneField = enumField(StringField, {
  options: [
    'Fields & Types',
    'Components & Views',
    'Tools & Commands',
    'Cards & Models',
  ],
  displayName: 'Lane',
});

const EvidenceTierField = enumField(StringField, {
  options: ['Platform', 'Catalog shared', 'Catalog listing', 'POC realm'],
  displayName: 'Evidence Tier',
});

const AuditStatusField = enumField(StringField, {
  options: ['Implemented', 'POC only', 'Extract from listing', 'Missing'],
  displayName: 'Audit Status',
});

const WorkStateField = enumField(StringField, {
  options: ['Done', 'In Progress', 'Next', 'Blocked'],
  displayName: 'Work State',
});

function tierClass(tier: string | undefined): string {
  switch (tier) {
    case 'Platform':
      return 'tier-platform';
    case 'Catalog shared':
      return 'tier-shared';
    case 'Catalog listing':
      return 'tier-listing';
    case 'POC realm':
      return 'tier-poc';
    default:
      return 'tier-none';
  }
}

function stateClass(state: string | undefined): string {
  switch (state) {
    case 'Done':
      return 'state-done';
    case 'In Progress':
      return 'state-progress';
    case 'Next':
      return 'state-next';
    case 'Blocked':
      return 'state-blocked';
    default:
      return 'state-none';
  }
}

export class MatrixConcept extends CardDef {
  static displayName = 'Matrix Concept';
  static icon = LayoutGridIcon;

  @field layer = contains(StringField);
  @field layerName = contains(StringField);
  @field lane = contains(LaneField);
  @field concept = contains(StringField);
  @field symbol = contains(StringField);
  @field implemented = contains(BooleanField);
  @field evidenceTier = contains(EvidenceTierField);
  @field auditStatus = contains(AuditStatusField);
  @field whereImplemented = contains(StringField);
  @field reference = contains(StringField, {
    description: 'Reference implementations that do not count as evidence.',
  });
  @field catalogMatch = contains(StringField);
  @field provenance = contains(StringField);
  @field domainKit = contains(StringField);
  @field owner = contains(StringField);
  @field workState = contains(WorkStateField);
  @field notes = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: MatrixConcept) {
      return this.concept?.trim()?.length
        ? this.concept
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  get tierClass() {
    return tierClass(this.evidenceTier);
  }

  static atom = class Atom extends Component<typeof MatrixConcept> {
    <template>
      <span class='concept-atom'>
        <span
          class='ca-symbol {{tierClass @model.evidenceTier}}'
        >{{@model.symbol}}</span>
        <span class='ca-name'>{{@model.concept}}</span>
      </span>
      <style scoped>
        .concept-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .ca-symbol {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.5rem;
          padding: 0.0625rem 0.25rem;
          border-radius: 0.25rem;
          font-size: 0.6875rem;
          font-weight: 700;
          font-family: var(--font-mono, monospace);
        }
        .ca-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tier-platform {
          background: var(--tier-platform-bg, #dcfce7);
          color: var(--tier-platform-fg, #166534);
        }
        .tier-shared {
          background: var(--tier-shared-bg, #dbeafe);
          color: var(--tier-shared-fg, #1e40af);
        }
        .tier-listing {
          background: var(--tier-listing-bg, #ede9fe);
          color: var(--tier-listing-fg, #5b21b6);
        }
        .tier-poc {
          background: var(--tier-poc-bg, #fef3c7);
          color: var(--tier-poc-fg, #92400e);
        }
        .tier-none {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof MatrixConcept> {
    <template>
      <div class='concept-row'>
        <span
          class='symbol {{tierClass @model.evidenceTier}}'
        >{{@model.symbol}}</span>
        <div class='info'>
          <span class='name'>{{@model.concept}}</span>
          <span class='meta'>Layer
            {{@model.layer}}
            ·
            {{@model.lane}}</span>
        </div>
        <span class='tier'>{{if
            @model.evidenceTier
            @model.evidenceTier
            '—'
          }}</span>
        <span class='state-col'>
          {{#if @model.workState}}
            <span
              class='state {{stateClass @model.workState}}'
            >{{@model.workState}}</span>
          {{/if}}
        </span>
      </div>
      <style scoped>
        .concept-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .symbol {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 0.5rem;
          font-weight: 700;
          font-family: var(--font-mono, monospace);
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
        .tier {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          width: 6.5rem;
          flex-shrink: 0;
        }
        .state-col {
          display: flex;
          justify-content: center;
          width: 6.5rem;
          flex-shrink: 0;
        }
        .state {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .tier-platform {
          background: var(--tier-platform-bg, #dcfce7);
          color: var(--tier-platform-fg, #166534);
        }
        .tier-shared {
          background: var(--tier-shared-bg, #dbeafe);
          color: var(--tier-shared-fg, #1e40af);
        }
        .tier-listing {
          background: var(--tier-listing-bg, #ede9fe);
          color: var(--tier-listing-fg, #5b21b6);
        }
        .tier-poc {
          background: var(--tier-poc-bg, #fef3c7);
          color: var(--tier-poc-fg, #92400e);
        }
        .tier-none {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .state-done {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .state-progress {
          background: var(--state-progress-bg, #dbeafe);
          color: var(--state-progress-fg, #1e40af);
        }
        .state-next {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .state-blocked {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .state-none {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof MatrixConcept> {
    <template>
      <div class='tile {{tierClass @model.evidenceTier}}'>
        <div class='top'>
          <span class='layer'>{{@model.layer}}</span>
          {{#if @model.implemented}}
            <span class='dot' title='Implemented'></span>
          {{/if}}
        </div>
        <span class='symbol'>{{@model.symbol}}</span>
        <span class='name'>{{@model.concept}}</span>
        <span class='line-lane'>{{@model.lane}}</span>
        <span class='line-tier'>{{if
            @model.evidenceTier
            @model.evidenceTier
            'No evidence'
          }}</span>
        {{#if @model.workState}}
          <span
            class='line-state state {{stateClass @model.workState}}'
          >{{@model.workState}}</span>
        {{/if}}
      </div>
      <style scoped>
        .tile {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.125rem;
          width: 100%;
          height: 100%;
          padding: 0.5rem 0.625rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
          border-left: 3px solid var(--tile-edge, transparent);
        }
        .tier-platform {
          --tile-edge: var(--tier-platform-fg, #166534);
        }
        .tier-shared {
          --tile-edge: var(--tier-shared-fg, #1e40af);
        }
        .tier-listing {
          --tile-edge: var(--tier-listing-fg, #5b21b6);
        }
        .tier-poc {
          --tile-edge: var(--tier-poc-fg, #92400e);
        }
        .tier-none {
          --tile-edge: var(--border, #e5e7eb);
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .layer {
          font-size: 0.5625rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .dot {
          width: 0.4375rem;
          height: 0.4375rem;
          border-radius: 999px;
          background: var(--tier-platform-fg, #166534);
        }
        .symbol {
          font-size: 1.125rem;
          font-weight: 700;
          font-family: var(--font-mono, monospace);
          line-height: 1.1;
        }
        .name {
          font-size: 0.6875rem;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-lane,
        .line-tier {
          display: none;
          font-size: 0.625rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-state {
          display: none;
          align-self: flex-start;
          margin-top: 0.25rem;
        }
        .state {
          font-size: 0.5625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.0625rem 0.375rem;
          border-radius: 999px;
        }
        .state-done {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .state-progress {
          background: var(--state-progress-bg, #dbeafe);
          color: var(--state-progress-fg, #1e40af);
        }
        .state-next {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .state-blocked {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        @container fitted-card (min-height: 90px) {
          .line-tier {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-lane {
            display: block;
          }
          .line-state {
            display: inline-flex;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof MatrixConcept> {
    <template>
      <article class='concept-page'>
        <header class='ch'>
          <span
            class='symbol {{tierClass @model.evidenceTier}}'
          >{{@model.symbol}}</span>
          <div class='ch-id'>
            <p class='doc-kind'>Layer
              {{@model.layer}}
              ·
              {{@model.layerName}}
              ·
              {{@model.lane}}</p>
            <h1>{{@model.concept}}</h1>
          </div>
          {{#if @model.workState}}
            <span
              class='state {{stateClass @model.workState}}'
            >{{@model.workState}}</span>
          {{/if}}
        </header>

        <section class='panel'>
          <h2>Evidence</h2>
          <dl>
            <dt>Implemented</dt>
            <dd>{{if @model.implemented 'Yes' 'No'}}</dd>
            <dt>Evidence tier</dt>
            <dd>{{if @model.evidenceTier @model.evidenceTier '—'}}</dd>
            {{#if @model.auditStatus}}
              <dt>Audit status</dt>
              <dd>{{@model.auditStatus}}</dd>
            {{/if}}
            {{#if @model.whereImplemented}}
              <dt>Where</dt>
              <dd class='mono'>{{@model.whereImplemented}}</dd>
            {{/if}}
            {{#if @model.catalogMatch}}
              <dt>Catalog match</dt>
              <dd class='mono'>{{@model.catalogMatch}}</dd>
            {{/if}}
            {{#if @model.reference}}
              <dt>Reference (not counted)</dt>
              <dd class='mono'>{{@model.reference}}</dd>
            {{/if}}
          </dl>
        </section>

        <section class='panel'>
          <h2>Identity</h2>
          <dl>
            {{#if @model.provenance}}
              <dt>Provenance</dt>
              <dd>{{@model.provenance}}</dd>
            {{/if}}
            {{#if @model.domainKit}}
              <dt>Domain kit</dt>
              <dd>{{@model.domainKit}}</dd>
            {{/if}}
            {{#if @model.owner}}
              <dt>Owner</dt>
              <dd>{{@model.owner}}</dd>
            {{/if}}
          </dl>
        </section>

        {{#if @model.notes}}
          <section class='panel'>
            <h2>Notes</h2>
            <p class='notes'>{{@model.notes}}</p>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .concept-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .ch {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .symbol {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 3.5rem;
          height: 3.5rem;
          border-radius: 0.75rem;
          font-size: 1.375rem;
          font-weight: 700;
          font-family: var(--font-mono, monospace);
          flex-shrink: 0;
        }
        .ch-id {
          flex: 1;
          min-width: 0;
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
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
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
          align-items: baseline;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .mono {
          font-family: var(--font-mono, monospace);
          font-size: 0.75rem;
        }
        .notes {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.5;
        }
        .state {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .tier-platform {
          background: var(--tier-platform-bg, #dcfce7);
          color: var(--tier-platform-fg, #166534);
        }
        .tier-shared {
          background: var(--tier-shared-bg, #dbeafe);
          color: var(--tier-shared-fg, #1e40af);
        }
        .tier-listing {
          background: var(--tier-listing-bg, #ede9fe);
          color: var(--tier-listing-fg, #5b21b6);
        }
        .tier-poc {
          background: var(--tier-poc-bg, #fef3c7);
          color: var(--tier-poc-fg, #92400e);
        }
        .tier-none {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .state-done {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .state-progress {
          background: var(--state-progress-bg, #dbeafe);
          color: var(--state-progress-fg, #1e40af);
        }
        .state-next {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .state-blocked {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
      </style>
    </template>
  };
}
