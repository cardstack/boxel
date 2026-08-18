import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import enumField from 'https://cardstack.com/base/enum';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import { ConceptReview } from './concept-review';
import { Teammate } from './teammate';
import ChangeWorkStateCommand from './change-work-state';

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
// Built and reserves done-language for review approval. Data keeps the sheet
// vocabulary.
export function displayState(state: string | undefined): string | undefined {
  return state === 'Done' ? 'Built' : state;
}

const ACTING_AS_KEY = 'matrix-acting-as';

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
  // Verifier-owned: URL of the Spec in the shared realm that evidences this
  // concept, and where that Spec's ref resolves to. Written by
  // verify-specs.py, never by hand or by the crawl.
  @field sharedSpec = contains(StringField);
  @field specTarget = contains(SpecTargetField);
  // Verifier-owned: shared-realm modules that import this concept's block —
  // proof of consumption, not a claim. consumerExamples maps each consumer
  // to a representative instance (JSON string) so the chip can open it live.
  @field consumers = contains(StringField);
  @field consumerExamples = contains(StringField);
  // Human-set during review, only meaningful on catalog-matched rows: a pure
  // listing can be spec'd as-is; otherwise a block must be built here first.
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

  static isolated = class Isolated extends Component<typeof MatrixConcept> {
    @tracked reviewVerdict = 'comment';
    @tracked reviewBody = '';
    @tracked reviewerId = '';
    @tracked newState = '';
    @tracked stateReason = '';
    @tracked statusMessage = '';
    @tracked busy = false;
    @tracked showReviewForm = false;

    private reviewList: ReturnType<getCards> | undefined;
    private teammateList: ReturnType<getCards> | undefined;
    private specResource: any;
    private consumerResources = new Map<string, any>();

    constructor(owner: Owner, args: any) {
      super(owner, args);
      try {
        this.reviewerId =
          globalThis.sessionStorage?.getItem(ACTING_AS_KEY) ?? '';
      } catch {
        // storage unavailable (prerender)
      }
      let ctx = this.args.context;
      let realms = () => this.realms;
      this.specResource = (ctx as any)?.getCard?.(
        this,
        () => (this.args.model as MatrixConcept)?.sharedSpec ?? undefined,
      );
      for (let [name, id] of Object.entries(this.consumerExampleIds)) {
        this.consumerResources.set(
          name,
          (ctx as any)?.getCard?.(this, () => id),
        );
      }
      this.reviewList = ctx?.getCards(
        this,
        () => {
          let id = (this.args.model as any)?.id;
          let ref = identifyCard(ConceptReview);
          return id && ref
            ? { filter: { on: ref, eq: { 'concept.id': id } } }
            : undefined;
        },
        realms,
        { isLive: true },
      );
      this.teammateList = ctx?.getCards(
        this,
        () => {
          let ref = identifyCard(Teammate);
          return ref ? { filter: { type: ref } } : undefined;
        },
        realms,
        { isLive: true },
      );
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }
    private get realm(): string | undefined {
      return this.realms?.[0];
    }
    private get commandContext() {
      return (this.args as any).context?.commandContext;
    }
    private get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }

    get reviews(): ConceptReview[] {
      return ((this.reviewList?.instances ?? []) as ConceptReview[])
        .filter(Boolean)
        .sort(
          (a, b) =>
            (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0),
        );
    }
    get teammates(): Teammate[] {
      return ((this.teammateList?.instances ?? []) as Teammate[]).filter(
        Boolean,
      );
    }
    get workStates() {
      return ['Done', 'In Progress', 'Next', 'Blocked'];
    }
    get verdicts() {
      return ['comment', 'approve', 'needs work'];
    }
    get selectedReviewer(): Teammate | undefined {
      return this.teammates.find((t) => (t as any).id === this.reviewerId);
    }

    // Derived from the thread, never stored — mirrors the tracker's logic.
    get reviewStatus(): string | undefined {
      let reviews = this.reviews;
      if (reviews.some((r) => r.verdict === 'needs work' && !r.resolved)) {
        return 'changes requested';
      }
      if (reviews.some((r) => r.verdict === 'approve')) {
        return 'approved';
      }
      if ((this.args.model as MatrixConcept).workState === 'Done') {
        return 'awaiting review';
      }
      return undefined;
    }

    // Claims wear outlines; derived facts get filled pills.
    get statusBadge(): { label: string; cls: string } | undefined {
      switch (this.reviewStatus) {
        case 'approved':
          return { label: 'Approved', cls: 'rs-approved' };
        case 'changes requested':
          return { label: 'Changes requested', cls: 'rs-changes' };
        case 'awaiting review':
          return { label: 'Built · awaiting review', cls: 'rs-waiting' };
      }
      let ws = (this.args.model as MatrixConcept).workState;
      return ws
        ? { label: displayState(ws)!, cls: stateClass(ws) }
        : undefined;
    }

    get ladder() {
      let m = this.args.model as MatrixConcept;
      let approved = this.reviewStatus === 'approved';
      return [
        {
          label: 'Built',
          // Code existing anywhere counts — a base/platform implementation
          // is built even when nobody has claimed it in workState.
          done:
            m.workState === 'Done' ||
            approved ||
            Boolean(m.implemented) ||
            Boolean(m.evidenceTier),
        },
        { label: 'Spec', done: Boolean(m.sharedSpec) },
        { label: 'Approved', done: approved },
      ];
    }

    get consumerList(): string[] {
      return ((this.args.model as MatrixConcept).consumers ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Kernel and Contracts rows ARE the platform — everything imports them,
    // so a consumer list there is definitional noise, not reuse evidence.
    get showConsumers(): boolean {
      let layer = (this.args.model as MatrixConcept).layer;
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

    @action openConsumer(card: CardDef) {
      (this.args as any).viewCard?.(card, 'isolated');
    }

    @action setVerdict(e: Event) {
      this.reviewVerdict = (e.target as HTMLSelectElement).value;
    }
    @action setReviewer(e: Event) {
      this.reviewerId = (e.target as HTMLSelectElement).value;
      try {
        globalThis.sessionStorage?.setItem(ACTING_AS_KEY, this.reviewerId);
      } catch {
        // storage unavailable
      }
    }
    @action setBody(e: Event) {
      this.reviewBody = (e.target as HTMLTextAreaElement).value;
    }
    @action setNewState(e: Event) {
      this.newState = (e.target as HTMLSelectElement).value;
    }
    @action setStateReason(e: Event) {
      this.stateReason = (e.target as HTMLInputElement).value;
    }
    @action toggleReviewForm() {
      this.showReviewForm = !this.showReviewForm;
    }

    private async saveReview(verdict: string, body: string): Promise<boolean> {
      if (!this.commandContext || !this.realm) return false;
      this.busy = true;
      this.statusMessage = 'Saving — the realm takes a few seconds…';
      try {
        await new SaveCardCommand(this.commandContext).execute({
          card: new ConceptReview({
            concept: this.args.model as MatrixConcept,
            reviewer: this.selectedReviewer,
            verdict,
            body,
            createdAt: new Date(),
            resolved: verdict !== 'needs work',
          }),
          realm: this.realm,
        } as any);
        this.statusMessage = '';
        return true;
      } catch (e: any) {
        this.statusMessage = e?.message ?? 'Review failed to save';
        return false;
      } finally {
        this.busy = false;
      }
    }

    @action async submitReview() {
      if (!this.reviewBody.trim()) {
        this.statusMessage = 'Write something first';
        return;
      }
      if (await this.saveReview(this.reviewVerdict, this.reviewBody.trim())) {
        this.reviewBody = '';
        this.showReviewForm = false;
      }
    }

    // Approval carries a name: an anonymous approve is worthless in a review
    // trail, so Acting as… is required here (comments may stay unattributed).
    @action async approve() {
      if (!this.selectedReviewer) {
        this.statusMessage = 'Pick who you are in "Acting as…" to approve';
        return;
      }
      let body =
        this.stateReason.trim() ||
        'Approved — Spec and evidence reviewed on the concept card.';
      if (await this.saveReview('approve', body)) {
        this.stateReason = '';
      }
    }

    @action async requestChanges() {
      if (!this.selectedReviewer) {
        this.statusMessage =
          'Pick who you are in "Acting as…" to request changes';
        return;
      }
      if (!this.stateReason.trim()) {
        this.statusMessage = 'Say what needs to change in the reason line';
        return;
      }
      if (await this.saveReview('needs work', this.stateReason.trim())) {
        this.stateReason = '';
      }
    }

    @action async changeState() {
      if (!this.commandContext || !this.realm || !this.newState) return;
      this.busy = true;
      try {
        let result: any = await new ChangeWorkStateCommand(
          this.commandContext,
        ).execute({
          concept: this.args.model as MatrixConcept,
          author: this.selectedReviewer,
          newState: this.newState,
          reason: this.stateReason,
          realm: this.realm,
        } as any);
        this.statusMessage = result?.message ?? 'State changed';
        this.newState = '';
        this.stateReason = '';
      } catch (e: any) {
        this.statusMessage = e?.message ?? 'State change failed';
      } finally {
        this.busy = false;
      }
    }

    get specCard(): CardDef | undefined {
      return this.specResource?.card;
    }

    @action openSpec() {
      let spec = this.specCard;
      if (spec) (this.args as any).viewCard?.(spec, 'isolated');
    }

    @action async resolveReview(review: ConceptReview) {
      if (!this.commandContext || !this.realm) return;
      this.busy = true;
      try {
        review.resolved = true;
        await new SaveCardCommand(this.commandContext).execute({
          card: review,
          realm: this.realm,
        } as any);
      } catch (e: any) {
        this.statusMessage = e?.message ?? 'Resolve failed';
      } finally {
        this.busy = false;
      }
    }

    reviewComponent = (card: ConceptReview) =>
      (card.constructor as typeof CardDef).getComponent(card);

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
            {{#if this.statusBadge}}
              <span
                class='state {{this.statusBadge.cls}}'
              >{{this.statusBadge.label}}</span>
            {{/if}}
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
                {{#if @model.sharedSpec}}
                  <dt>Spec</dt>
                  <dd>
                    {{#if this.specCard}}
                      <button
                        type='button'
                        class='spec-link'
                        {{on 'click' this.openSpec}}
                      >Open the Spec to review →</button>
                    {{else if this.isInteractive}}
                      <span class='spec-link spec-loading'>Loading Spec…</span>
                    {{else}}
                      <a
                        class='spec-link'
                        href={{@model.sharedSpec}}
                        target='_blank'
                        rel='noopener noreferrer'
                      >Open the Spec to review ↗</a>
                    {{/if}}
                    {{#if @model.specTarget}}
                      <span class='spec-target'>ref →
                        {{@model.specTarget}}</span>
                    {{/if}}
                  </dd>
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
            {{#if this.isInteractive}}
              <section class='panel'>
                <h2>Workflow</h2>
                <div class='action-row'>
                  <select
                    aria-label='Acting as'
                    {{on 'change' this.setReviewer}}
                  >
                    <option value='' selected={{eq this.reviewerId ''}}>Acting
                      as…</option>
                    {{#each this.teammates as |t|}}
                      <option
                        value={{t.id}}
                        selected={{eq this.reviewerId t.id}}
                      >{{t.name}}</option>
                    {{/each}}
                  </select>
                  <input
                    type='text'
                    placeholder='Reason (one line)'
                    value={{this.stateReason}}
                    aria-label='Reason'
                    {{on 'input' this.setStateReason}}
                  />
                </div>
                <div class='action-row verdict-row'>
                  <BoxelButton
                    @kind='primary'
                    @size='extra-small'
                    @loading={{this.busy}}
                    @disabled={{this.busy}}
                    {{on 'click' this.approve}}
                  >Approve</BoxelButton>
                  <BoxelButton
                    @kind='secondary'
                    @size='extra-small'
                    @disabled={{this.busy}}
                    {{on 'click' this.requestChanges}}
                  >Request changes</BoxelButton>
                  <select
                    aria-label='New state'
                    {{on 'change' this.setNewState}}
                  >
                    <option value='' selected={{eq this.newState ''}}>Change
                      state to…</option>
                    {{#each this.workStates as |s|}}
                      <option
                        value={{s}}
                        selected={{eq this.newState s}}
                      >{{displayState s}}</option>
                    {{/each}}
                  </select>
                  <BoxelButton
                    @kind='secondary'
                    @size='extra-small'
                    @disabled={{this.busy}}
                    {{on 'click' this.changeState}}
                  >Change state</BoxelButton>
                </div>
                {{#if this.statusMessage}}
                  <p class='status'>{{this.statusMessage}}</p>
                {{/if}}
              </section>
            {{/if}}

            <section class='panel'>
              <h2>Reviews</h2>
              {{#if this.isInteractive}}
                {{#if this.showReviewForm}}
                  <div class='review-form'>
                    <div class='action-row'>
                      <select
                        aria-label='Verdict'
                        {{on 'change' this.setVerdict}}
                      >
                        {{#each this.verdicts as |v|}}
                          <option
                            value={{v}}
                            selected={{eq this.reviewVerdict v}}
                          >{{v}}</option>
                        {{/each}}
                      </select>
                      <span class='hint'>reviewing as
                        {{if
                          this.selectedReviewer.name
                          this.selectedReviewer.name
                          '…'
                        }}</span>
                    </div>
                    <textarea
                      rows='3'
                      placeholder='What did you find? Approvals and change requests both deserve a reason.'
                      aria-label='Review body'
                      value={{this.reviewBody}}
                      {{on 'input' this.setBody}}
                    ></textarea>
                    <div class='form-actions'>
                      <BoxelButton
                        @kind='primary'
                        @size='extra-small'
                        @disabled={{this.busy}}
                        {{on 'click' this.submitReview}}
                      >Submit review</BoxelButton>
                      <BoxelButton
                        @kind='text-only'
                        @size='extra-small'
                        {{on 'click' this.toggleReviewForm}}
                      >Cancel</BoxelButton>
                    </div>
                  </div>
                {{else}}
                  <div class='review-form-cta'>
                    <BoxelButton
                      @kind='secondary'
                      @size='extra-small'
                      {{on 'click' this.toggleReviewForm}}
                    >Write review</BoxelButton>
                  </div>
                {{/if}}
              {{/if}}
              <div class='thread'>
                {{#each this.reviews as |r|}}
                  <div class='thread-item'>
                    {{#let (this.reviewComponent r) as |R|}}
                      <R @format='embedded' />
                    {{/let}}
                    {{#if this.isInteractive}}
                      {{#unless r.resolved}}
                        <BoxelButton
                          @kind='text-only'
                          @size='extra-small'
                          @disabled={{this.busy}}
                          {{on 'click' (fn this.resolveReview r)}}
                        >Mark resolved</BoxelButton>
                      {{/unless}}
                    {{/if}}
                  </div>
                {{else}}
                  <p class='empty'>No reviews yet</p>
                {{/each}}
              </div>
            </section>
          </div>
        </div>
      </article>
      <style scoped>
        .concept-page {
          max-width: 72rem;
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
        .spec-link {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--tier-shared-fg, #1e40af);
          text-decoration: none;
          border: 1px solid currentColor;
          border-radius: 0.5rem;
          padding: 0.25rem 0.625rem;
        }
        .spec-link:hover {
          background: var(--tier-shared-bg, #dbeafe);
        }
        button.spec-link {
          font: inherit;
          font-size: 0.8125rem;
          font-weight: 600;
          background: transparent;
          cursor: pointer;
        }
        .spec-loading {
          color: var(--muted-foreground, #6b7280);
          border-color: var(--border, #e5e7eb);
        }
        .spec-loading:hover {
          background: transparent;
        }
        .spec-target {
          margin-left: 0.5rem;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, #6b7280);
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
        .action-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
        }
        .action-row select,
        .action-row input,
        .review-form textarea {
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.375rem 0.5rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: var(--card, #ffffff);
          color: inherit;
        }
        .action-row input {
          flex: 1;
          min-width: 10rem;
        }
        .review-form {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
        .review-form textarea {
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
        }
        .form-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }
        .review-form-cta {
          margin-bottom: 1rem;
        }
        .hint {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .status {
          margin: 0.5rem 0 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .thread {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .thread-item {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .thread-item > :deep(.boxel-card-container) {
          box-shadow: none;
        }
        .empty {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
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
        .rs-approved {
          background: var(--state-done-bg, #dcfce7);
          color: var(--tier-platform-fg, #166534);
        }
        .rs-waiting {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .rs-changes {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
      </style>
    </template>
  };
}
