import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import enumField from 'https://cardstack.com/base/enum';
import type Owner from '@ember/owner';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import { Meter } from 'https://realms-staging.stack.cards/richard.tan1/pretui/ink';
import {
  qualityChecks,
  qualityBucket,
  qualityScore,
  qualityApplicable,
  bucketLabel,
  type CheckState,
  type QualityCheck,
} from './spec-quality';

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

const SpecTargetField = enumField(StringField, {
  options: ['shared block', 'base realm', 'catalog', 'platform package'],
  displayName: 'Spec Target',
});

const CatalogDispositionField = enumField(StringField, {
  options: ['pure listing', 'needs block'],
  displayName: 'Catalog Disposition',
});

const ConceptKindField = enumField(StringField, {
  options: ['field', 'card', 'app', 'component', 'command', 'filedef'],
  displayName: 'Concept Kind',
});

// Only 'block' rows are scored and counted. The rest are matrix rows that are
// not blocks anyone can adopt: wire-format primitives, platform internals, and
// bare labels absorbed by a more precise sibling.
const ConceptScopeField = enumField(StringField, {
  options: ['block', 'primitive', 'internal', 'alias'],
  displayName: 'Scope',
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

// "Done" is the builder's claim, not the pipeline's verdict — the UI says
// Built and reserves done-language for spec quality. Data keeps the sheet
// vocabulary.
export function displayState(state: string | undefined): string | undefined {
  return state === 'Done' ? 'Built' : state;
}

function checkMark(state: CheckState): string {
  return state === 'pass' ? '\u2713' : state === 'na' ? '\u2013' : '\u2717';
}

export class MatrixConcept extends CardDef {
  static prefersWideFormat = true;
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
  // Crawl-stamped: URL of the Spec in the shared realm that evidences this
  // concept, where that Spec's ref resolves to, and when it first verified.
  @field sharedSpec = contains(StringField);
  @field specTarget = contains(SpecTargetField);
  @field verifiedAt = contains(DateTimeField);
  // Crawl-stamped Spec facts, so quality computes without loading the Spec:
  // the Spec's specType, its example count, and its readMe length.
  @field specKind = contains(StringField);
  @field specExampleCount = contains(NumberField);
  @field specReadmeChars = contains(NumberField);
  // Crawl-stamped, kind-specific example evidence: files attached to the Spec
  // (a file def is shown by a file), fenced code blocks in the readMe (how a
  // command is called), and the module that renders a component's states.
  @field specFileExampleCount = contains(NumberField);
  @field specReadmeCodeBlocks = contains(NumberField);
  @field specUsageRef = contains(StringField);
  // What kind of thing this concept is, which rubric it scores against, and —
  // when scope is 'alias' — the concept that absorbed it.
  @field conceptKind = contains(ConceptKindField);
  @field scope = contains(ConceptScopeField);
  @field aliasOf = contains(StringField);
  // Crawl-stamped: the Spec's linked-example instance URLs (JSON array), so
  // the card can render the examples live without loading the Spec's links.
  @field specExampleIds = contains(StringField);
  // Crawl-stamped: shared-realm modules that import this concept's block —
  // proof of consumption, not a claim. consumerExamples maps each consumer
  // to a representative instance (JSON string) so the chip can open it live.
  @field consumers = contains(StringField);
  @field consumerExamples = contains(StringField);
  // Human-set, only meaningful on catalog-matched rows: a pure listing can
  // be spec'd as-is; otherwise a block must be built here first.
  @field catalogDisposition = contains(CatalogDispositionField);

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
            >{{displayState @model.workState}}</span>
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
          border: 1px solid var(--state-built-fg, #334155);
          color: var(--state-built-fg, #334155);
          background: transparent;
        }
        .state-progress {
          border: 1px solid var(--state-progress-fg, #1e40af);
          color: var(--state-progress-fg, #1e40af);
          background: transparent;
        }
        .state-next {
          border: 1px solid var(--state-next-fg, #92400e);
          color: var(--state-next-fg, #92400e);
          background: transparent;
        }
        .state-blocked {
          border: 1px solid var(--state-blocked-fg, #991b1b);
          color: var(--state-blocked-fg, #991b1b);
          background: transparent;
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
            <span class='dot' title='Code exists'></span>
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
          >{{displayState @model.workState}}</span>
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
          border: 1px solid var(--state-built-fg, #334155);
          color: var(--state-built-fg, #334155);
          background: transparent;
        }
        .state-progress {
          border: 1px solid var(--state-progress-fg, #1e40af);
          color: var(--state-progress-fg, #1e40af);
          background: transparent;
        }
        .state-next {
          border: 1px solid var(--state-next-fg, #92400e);
          color: var(--state-next-fg, #92400e);
          background: transparent;
        }
        .state-blocked {
          border: 1px solid var(--state-blocked-fg, #991b1b);
          color: var(--state-blocked-fg, #991b1b);
          background: transparent;
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

  // Read-only by design: the crawl owns evidence, the verifier owns spec
  // fields, the sheet owns owner/state/notes. The card is a lens, not a form.
  static isolated = class Isolated extends Component<typeof MatrixConcept> {
    private specResource: any;
    private consumerResources = new Map<string, any>();
    private exampleResources: any[] = [];

    constructor(owner: Owner, args: any) {
      super(owner, args);
      let ctx = this.args.context;
      this.specResource = (ctx as any)?.getCard?.(
        this,
        () => (this.args.model as MatrixConcept)?.sharedSpec ?? undefined,
      );
      this.exampleResources = this.exampleIds.map((id) =>
        (ctx as any)?.getCard?.(this, () => id),
      );
      for (let [name, id] of Object.entries(this.consumerExampleIds)) {
        this.consumerResources.set(
          name,
          (ctx as any)?.getCard?.(this, () => id),
        );
      }
    }

    private get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }

    private get model(): MatrixConcept {
      return this.args.model as MatrixConcept;
    }

    get checks(): QualityCheck[] {
      return qualityChecks(this.model);
    }
    get score() {
      return qualityScore(this.model);
    }
    get applicable() {
      return qualityApplicable(this.model);
    }
    get bucket() {
      return qualityBucket(this.model);
    }
    get bucketName() {
      return bucketLabel(this.bucket);
    }
    get hasSpec() {
      return Boolean(this.model.sharedSpec);
    }

    // Claims wear outlines; derived quality gets the filled pill.
    get qualityClass() {
      switch (this.bucket) {
        case 'gold':
          return 'q-gold';
        case 'solid':
          return 'q-solid';
        case 'adequate':
          return 'q-adequate';
        case 'thin':
          return 'q-thin';
        default:
          return 'q-none';
      }
    }

    get ladder() {
      let m = this.model;
      return [
        {
          label: 'Built',
          // Code existing anywhere counts — a base/platform implementation
          // is built even when nobody has claimed it in workState.
          done:
            m.workState === 'Done' ||
            Boolean(m.implemented) ||
            Boolean(m.evidenceTier),
        },
        { label: 'Spec', done: Boolean(m.sharedSpec) },
        {
          label: 'Quality',
          done: this.bucket === 'gold' || this.bucket === 'solid',
        },
      ];
    }

    get consumerList(): string[] {
      return (this.model.consumers ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Kernel and Contracts rows ARE the platform — everything imports them,
    // so a consumer list there is definitional noise, not reuse evidence.
    get showConsumers(): boolean {
      let layer = this.model.layer;
      return layer !== '01' && layer !== '02' && this.consumerList.length > 0;
    }

    private get consumerExampleIds(): Record<string, string> {
      try {
        let raw = (this.args.model as MatrixConcept)?.consumerExamples;
        let parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    get consumerEntries(): { name: string; card?: CardDef }[] {
      return this.consumerList.map((name) => ({
        name,
        card: this.consumerResources.get(name)?.card,
      }));
    }

    get specCard(): CardDef | undefined {
      return this.specResource?.card;
    }

    private get exampleIds(): string[] {
      try {
        let raw = (this.args.model as MatrixConcept)?.specExampleIds;
        let parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
      } catch {
        return [];
      }
    }

    get exampleCards(): CardDef[] {
      return this.exampleResources
        .map((r) => r?.card)
        .filter(Boolean) as CardDef[];
    }

    // Contained examples live inside the Spec and have no standalone render
    // identity — the Spec frame below is where they show.
    get containedOnly(): boolean {
      return (
        this.exampleIds.length === 0 &&
        ((this.args.model as MatrixConcept).specExampleCount ?? 0) > 0
      );
    }

    specComponent = (card: CardDef) =>
      (card.constructor as typeof CardDef).getComponent(card);

    @action openConsumer(card: CardDef) {
      (this.args as any).viewCard?.(card, 'isolated');
    }

    @action openSpec() {
      let spec = this.specCard;
      if (spec) (this.args as any).viewCard?.(spec, 'isolated');
    }

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
          <div class='ch-status'>
            <div class='badge-row'>
              {{#if this.hasSpec}}
                <span
                  class='state {{this.qualityClass}}'
                >{{this.bucketName}}
                  · {{this.score}}/{{this.applicable}}</span>
              {{/if}}
              {{#if @model.workState}}
                <span
                  class='state {{stateClass @model.workState}}'
                >{{displayState @model.workState}}</span>
              {{/if}}
            </div>
            <ol class='ladder'>
              {{#each this.ladder as |step|}}
                <li class='ladder-step {{if step.done "is-done"}}'>
                  <span class='ladder-dot'></span>
                  {{step.label}}
                </li>
              {{/each}}
            </ol>
          </div>
        </header>

        <div class='cols'>
          <div class='col'>
            <section class='panel'>
              <div class='panel-head'>
                <h2>Spec quality</h2>
                <Meter
                  @level={{this.score}}
                  @segments={{this.applicable}}
                  @label='{{this.score}} of {{this.applicable}} checks pass'
                  @hue={{if this.hasSpec '#ca8a04' '#9ca3af'}}
                  @heights={{meterHeights}}
                />
              </div>
              <ul class='checklist'>
                {{#each this.checks as |check|}}
                  <li class='check is-{{check.state}}'>
                    <span class='check-mark'>{{checkMark check.state}}</span>
                    <span class='check-label'>{{check.label}}</span>
                    <span class='check-detail'>{{check.detail}}</span>
                  </li>
                {{/each}}
              </ul>
            </section>

            <section class='panel'>
              <h2>Evidence</h2>
              <dl>
                <dt>Crawl-counted</dt>
                <dd>{{if @model.implemented 'Yes' 'No'}}</dd>
                <dt>Evidence tier</dt>
                <dd>{{if @model.evidenceTier @model.evidenceTier '—'}}</dd>
                {{#if @model.whereImplemented}}
                  <dt>Where</dt>
                  <dd class='mono'>{{@model.whereImplemented}}</dd>
                {{/if}}
                {{#if @model.catalogMatch}}
                  <dt>Catalog match</dt>
                  <dd class='mono'>{{@model.catalogMatch}}</dd>
                {{/if}}
                {{#if @model.catalogDisposition}}
                  <dt>Catalog disposition</dt>
                  <dd>{{@model.catalogDisposition}}</dd>
                {{/if}}
                {{#if @model.specTarget}}
                  <dt>Spec ref</dt>
                  <dd>{{@model.specTarget}}</dd>
                {{/if}}
                {{#if @model.verifiedAt}}
                  <dt>Verified</dt>
                  <dd><@fields.verifiedAt /></dd>
                {{/if}}
                {{#if this.showConsumers}}
                  <dt>Used by</dt>
                  <dd class='consumers'>
                    {{#each this.consumerEntries as |entry|}}
                      {{#if entry.card}}
                        <button
                          type='button'
                          class='consumer-chip consumer-link'
                          title='Open {{entry.name}} to see this in use'
                          {{on 'click' (fn this.openConsumer entry.card)}}
                        >{{entry.name}} →</button>
                      {{else}}
                        <span class='consumer-chip'>{{entry.name}}</span>
                      {{/if}}
                    {{/each}}
                  </dd>
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
          </div>

          <div class='col'>
            {{#if this.exampleCards.length}}
              <section class='panel'>
                <h2>Examples — live</h2>
                <div class='example-list'>
                  {{#each this.exampleCards as |ex|}}
                    <button
                      type='button'
                      class='example-item'
                      title='Open this example'
                      {{on 'click' (fn this.openConsumer ex)}}
                    >
                      {{#let (this.specComponent ex) as |Ex|}}
                        <Ex @format='embedded' />
                      {{/let}}
                    </button>
                  {{/each}}
                </div>
              </section>
            {{else if this.containedOnly}}
              <section class='panel'>
                <h2>Examples — live</h2>
                <p class='empty'>This Spec carries contained field examples —
                  they render inside the Spec below.</p>
              </section>
            {{/if}}
            {{#if this.hasSpec}}
              <section class='panel spec-panel'>
                <div class='panel-head'>
                  <h2>Spec &amp; example — live</h2>
                  {{#if this.isInteractive}}
                    {{#if this.specCard}}
                      <button
                        type='button'
                        class='spec-open'
                        {{on 'click' this.openSpec}}
                      >Open →</button>
                    {{/if}}
                  {{else}}
                    <a
                      class='spec-open'
                      href={{@model.sharedSpec}}
                      target='_blank'
                      rel='noopener noreferrer'
                    >Open ↗</a>
                  {{/if}}
                </div>
                {{#if this.specCard}}
                  <div class='spec-frame'>
                    {{#let (this.specComponent this.specCard) as |SpecView|}}
                      <SpecView @format='isolated' />
                    {{/let}}
                  </div>
                {{else}}
                  <p class='empty'>Loading Spec…</p>
                {{/if}}
              </section>
            {{else}}
              <section class='panel'>
                <h2>Spec &amp; example</h2>
                <p class='empty'>No Spec yet — the checklist on the left is
                  the to-do list. A Spec in the shared realm whose ref
                  resolves is what makes this concept count as done.</p>
              </section>
            {{/if}}
          </div>
        </div>
      </article>
      <style scoped>
        .concept-page {
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
          flex-wrap: wrap;
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
          min-width: 14rem;
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
        .ch-status {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.5rem;
        }
        .badge-row {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .ladder {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          align-items: center;
          gap: 0;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, #9ca3af);
        }
        .ladder-step {
          display: flex;
          align-items: center;
          gap: 0.3125rem;
        }
        .ladder-step + .ladder-step::before {
          content: '';
          display: block;
          width: 1.25rem;
          height: 1px;
          margin: 0 0.375rem;
          background: var(--border, #e5e7eb);
        }
        .ladder-dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 999px;
          border: 1.5px solid var(--border, #d1d5db);
          background: transparent;
        }
        .ladder-step.is-done {
          color: var(--foreground, #111111);
        }
        .ladder-step.is-done .ladder-dot {
          border-color: var(--state-done-check, #16a34a);
          background: var(--state-done-check, #16a34a);
        }
        .cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
          gap: 1.25rem;
          align-items: start;
        }
        .col {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          min-width: 0;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .panel-head h2 {
          margin: 0;
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .checklist {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .check {
          display: grid;
          grid-template-columns: 1.125rem 1fr;
          column-gap: 0.5rem;
          row-gap: 0.0625rem;
          font-size: 0.8125rem;
          align-items: baseline;
        }
        .check-mark {
          font-weight: 700;
          text-align: center;
        }
        .check.is-pass .check-mark {
          color: var(--state-done-check, #16a34a);
        }
        .check.is-fail .check-mark {
          color: var(--state-blocked-fg, #991b1b);
        }
        .check.is-na .check-mark {
          color: var(--muted-foreground, #9ca3af);
        }
        .check.is-na .check-label,
        .check.is-na .check-detail {
          color: var(--muted-foreground, #9ca3af);
        }
        .check-label {
          font-weight: 600;
        }
        .check.is-fail .check-label {
          color: var(--foreground, #111111);
        }
        .check-detail {
          grid-column: 2;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          line-height: 1.4;
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
        .consumers {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }
        .consumer-chip {
          font-family: var(--font-mono, monospace);
          font-size: 0.6875rem;
          padding: 0.125rem 0.4375rem;
          border-radius: 0.375rem;
          background: var(--muted, #f3f4f6);
          color: var(--foreground, #374151);
        }
        button.consumer-link {
          border: 1px solid var(--tier-shared-fg, #1e40af);
          background: transparent;
          color: var(--tier-shared-fg, #1e40af);
          font-weight: 600;
          cursor: pointer;
        }
        button.consumer-link:hover {
          background: var(--tier-shared-bg, #dbeafe);
        }
        .notes {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.5;
        }
        .spec-open {
          font: inherit;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--tier-shared-fg, #1e40af);
          text-decoration: none;
          border: 1px solid currentColor;
          border-radius: 0.5rem;
          padding: 0.25rem 0.625rem;
          background: transparent;
          cursor: pointer;
          white-space: nowrap;
        }
        .spec-open:hover {
          background: var(--tier-shared-bg, #dbeafe);
        }
        .example-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .example-item {
          font: inherit;
          text-align: left;
          padding: 0;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: transparent;
          color: inherit;
          cursor: pointer;
          overflow: hidden;
        }
        .example-item:hover {
          border-color: var(--foreground, #111111);
        }
        .example-item :deep(.boxel-card-container) {
          box-shadow: none;
          background: transparent;
        }
        .spec-frame {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          max-height: 42rem;
          overflow-y: auto;
          background: var(--background, #fafafa);
        }
        .spec-frame :deep(.boxel-card-container) {
          box-shadow: none;
          background: transparent;
        }
        .empty {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
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
          border: 1px solid var(--state-built-fg, #334155);
          color: var(--state-built-fg, #334155);
          background: transparent;
        }
        .state-progress {
          border: 1px solid var(--state-progress-fg, #1e40af);
          color: var(--state-progress-fg, #1e40af);
          background: transparent;
        }
        .state-next {
          border: 1px solid var(--state-next-fg, #92400e);
          color: var(--state-next-fg, #92400e);
          background: transparent;
        }
        .state-blocked {
          border: 1px solid var(--state-blocked-fg, #991b1b);
          color: var(--state-blocked-fg, #991b1b);
          background: transparent;
        }
        .q-gold {
          background: #fef9c3;
          color: #854d0e;
        }
        .q-solid {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .q-adequate {
          background: var(--tier-shared-bg, #dbeafe);
          color: var(--tier-shared-fg, #1e40af);
        }
        .q-thin {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .q-none {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}

const meterHeights = [8, 8, 8, 8, 8, 8];
