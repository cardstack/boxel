import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import enumField from '@cardstack/base/enum';
import { FileDef } from '@cardstack/base/file-api';
import HandshakeIcon from '@cardstack/boxel-icons/handshake';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { BoxelButton } from '@cardstack/boxel-ui/components';

import { Candidate } from './candidate';
import { Position } from './position';
import { ApprovalChainField } from './approval-chain-field';
import { ApproveChainStepCommand } from './commands/approve-chain-step-command';
import {
  daysBetween,
  initialsOf,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

export const OFFER_STATUSES = [
  'draft',
  'extended',
  'accepted',
  'declined',
  'rescinded',
];

// Colocated with Offer — the closing chapter of the Candidate story. Draft
// is stone (not yet real), extended reuses Candidate's "offer" stage brass
// exactly (the same seal going out the door), accepted resolves into the
// hired/active forest green, declined and rescinded both land on rust —
// the offer ended without a hire either way.
export const OFFER_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('amber'),
  extended: stateColor('orange'),
  accepted: stateColor('green'),
  declined: stateColor('red'),
  rescinded: stateColor('red'),
};

// Display labels for the offer lifecycle. The stored values stay as they are
// — they are the industry vocabulary and they feed reports and filters — but
// a raw enum value is not a UI label. Each label answers "whose turn is it",
// which is the only thing a reader of a board needs from a status chip.
export const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft · not sent',
  extended: 'Awaiting reply',
  accepted: 'Accepted',
  declined: 'Declined',
  rescinded: 'Rescinded',
};

export function offerStatusLabel(status?: string | null): string | undefined {
  if (!status) {
    return undefined;
  }
  return OFFER_STATUS_LABELS[status] ?? status;
}

export const OfferStatusField = enumField(StringField, {
  options: OFFER_STATUSES.map((status) => ({ value: status, label: status })),
  displayName: 'Offer Status',
});

export class Offer extends CardDef {
  static displayName = 'Offer';
  static icon = HandshakeIcon;

  @field candidate = linksTo(() => Candidate);
  @field position = linksTo(() => Position);
  @field offeredTitle = contains(StringField, {
    description: 'Job title extended in this offer',
  });
  @field salary = contains(NumberField);
  @field equity = contains(NumberField, {
    description: 'Equity grant, e.g. number of shares/units',
  });
  @field bonus = contains(NumberField, {
    description: 'Signing or annual bonus amount',
  });
  @field startDate = contains(DateField);
  @field extendedDate = contains(DateField);
  @field expirationDate = contains(DateField, {
    description: 'Date this offer lapses if not accepted',
  });
  @field decisionDate = contains(DateField);
  @field approvalChain = contains(ApprovalChainField);
  @field offerLetterFile = linksTo(FileDef, { searchable: true });
  @field status = contains(OfferStatusField);

  // Denormalized for fitted — prerendered fitted does not resolve linksTo.
  @field candidateName = contains(StringField, {
    computeVia: function (this: Offer) {
      return this.candidate?.name ?? '';
    },
  });

  @field positionTitle = contains(StringField, {
    computeVia: function (this: Offer) {
      return this.position?.jobTitle ?? '';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Offer) {
      let who = this.candidate?.name?.trim();
      return who ? `Offer — ${who}` : 'Untitled Offer';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get salaryLabel(): string | undefined {
      let v = this.args.model?.salary;
      return v != null ? `$${v.toLocaleString()}` : undefined;
    }
    get equityLabel(): string | undefined {
      let v = this.args.model?.equity;
      return v != null ? `${v.toLocaleString()} shares` : undefined;
    }
    get bonusLabel(): string {
      let v = this.args.model?.bonus;
      if (v == null) {
        return '—';
      }
      return v === 0 ? '$0 · confirmed none' : `$${v.toLocaleString()}`;
    }
    get statusStyle() {
      let c = stateColorOf(OFFER_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    get statusLabel(): string | undefined {
      let status = this.args.model?.status;
      if (!status) {
        return undefined;
      }
      let label = status.charAt(0).toUpperCase() + status.slice(1);
      if (status === 'extended') {
        let expires = this.args.model?.expirationDate;
        let days = expires ? daysBetween(new Date(), expires) : undefined;
        if (days != null) {
          return days <= 0
            ? `${label} · expired`
            : `${label} · expires in ${days}d`;
        }
      }
      return label;
    }
    get lifecycleSteps() {
      // draft/extended/accepted is the happy path; declined/rescinded are
      // terminal branches. An offer can only be declined or rescinded after
      // being extended, so those two statuses keep 'draft' and 'extended'
      // marked done rather than blanking the whole timeline.
      let order = ['draft', 'extended', 'accepted'];
      let status = this.args.model?.status;
      let terminal = status === 'declined' || status === 'rescinded';
      let idx = terminal
        ? order.indexOf('extended')
        : order.indexOf(status ?? '');
      let label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      let steps = order.map((step, i) => ({
        step,
        label: label(step),
        done: idx >= 0 && i <= idx,
        current: !terminal && idx >= 0 && i === idx,
        negative: false,
      }));
      if (terminal && status) {
        steps.push({
          step: status,
          label: label(status),
          done: true,
          current: true,
          negative: true,
        });
      }
      return steps;
    }
    get initials() {
      return initialsOf(
        this.args.model?.candidateName || this.args.model?.title,
      );
    }

    get expiresNote(): string | undefined {
      let expires = this.args.model?.expirationDate;
      if (!expires) {
        return undefined;
      }
      let days = daysBetween(new Date(), expires);
      if (days == null) {
        return undefined;
      }
      return days <= 0 ? 'Expired' : `${days} days to respond`;
    }

    // The click-to-decide affordance lives here, not inside
    // ApprovalChainField's own template — see approval-chain-field.gts's
    // class comment for why. This mirrors how every other stage-changing
    // action in this app (ApproveOfferCommand, RejectCandidateCommand) is
    // invoked from the consuming card/tracker rather than from a field.
    @tracked approvalBusy = false;
    @tracked approvalError: string | undefined;

    get canDecideApproval(): boolean {
      return this.args.model?.approvalChain?.status === 'in-progress';
    }

    decideApprovalStep = (decision: 'approved' | 'rejected') => {
      void this.decideApprovalStepTask(decision);
    };

    private decideApprovalStepTask = async (
      decision: 'approved' | 'rejected',
    ) => {
      let model = this.args.model;
      let chain = model?.approvalChain;
      if (!model || !chain) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.approvalError = 'Commands are unavailable in this mode';
        return;
      }
      this.approvalError = undefined;
      this.approvalBusy = true;
      try {
        await new ApproveChainStepCommand(commandContext).execute({
          target: model,
          stepIndex: chain.currentStepIndex,
          decision,
        } as any);
      } catch (error: any) {
        this.approvalError = error?.message ?? String(error);
      } finally {
        this.approvalBusy = false;
      }
    };

    <template>
      <article class='offer-isolated'>
        <header class='hero'>
          <span class='avatar' aria-hidden='true'>{{this.initials}}</span>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{#if @model.offeredTitle}}{{@model.offeredTitle}}{{/if}}
              {{#if @model.positionTitle}}
                <span class='sep-dot'>&middot;</span>
                {{@model.positionTitle}}
              {{/if}}
            </p>
            <div class='pill-row'>
              {{! The status pill the isolated view previously never rendered,
                  even though statusStyle/statusLabel already existed. }}
              {{#if this.statusLabel}}
                <span class='pill' style={{this.statusStyle}}>
                  <span class='pill-dot'></span>{{this.statusLabel}}
                </span>
              {{/if}}
              {{#if this.expiresNote}}
                <span class='pill neutral'>{{this.expiresNote}}</span>
              {{/if}}
            </div>
          </div>
          <div class='hero-money'>
            {{#if this.salaryLabel}}
              <span class='money'>{{this.salaryLabel}}</span>
            {{/if}}
            {{#if @model.startDate}}
              <span class='money-label'>starts <@fields.startDate /></span>
            {{/if}}
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Progress</h2>
            <ol class='timeline'>
              {{#each this.lifecycleSteps as |s|}}
                <li
                  class='step
                    {{if s.done "done"}}
                    {{if s.current "current"}}
                    {{if s.negative "negative"}}'
                >
                  <span class='step-dot'></span>
                  <span class='step-label'>{{s.label}}</span>
                </li>
              {{/each}}
            </ol>

            <h2 class='panel-title spaced'>Compensation</h2>
            <dl class='facts'>
              <dt>Base salary</dt>
              <dd>{{if this.salaryLabel this.salaryLabel '—'}}</dd>
              <dt>Equity</dt>
              <dd>{{if this.equityLabel this.equityLabel '—'}}</dd>
              <dt>Signing bonus</dt>
              <dd>{{this.bonusLabel}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Key dates</h2>
            <dl class='facts'>
              <dt>Extended</dt>
              <dd>{{#if @model.extendedDate}}<@fields.extendedDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Expires</dt>
              <dd>{{#if @model.expirationDate}}<@fields.expirationDate />{{#if
                    this.expiresNote
                  }}<span class='dd-note'>
                      &middot;
                      {{this.expiresNote}}</span>{{/if}}{{else}}&mdash;{{/if}}</dd>
              <dt>Start date</dt>
              <dd>{{#if @model.startDate}}<@fields.startDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Decision</dt>
              <dd>{{#if @model.decisionDate}}<@fields.decisionDate
                  />{{else}}&mdash; awaiting response{{/if}}</dd>
            </dl>
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Candidate</h2>
            {{#if @model.candidate}}
              <div class='linked'><@fields.candidate
                  @format='embedded'
                  @displayContainer={{false}}
                /></div>
            {{else}}
              <p class='empty'>No candidate linked — an offer should always
                point at one.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Approval</h2>
            <dl class='facts stacked'>
              <dt>Offer letter</dt>
              <dd>{{#if @model.offerLetterFile}}<@fields.offerLetterFile
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash; not attached{{/if}}</dd>
            </dl>
            <@fields.approvalChain />
            {{#if this.canDecideApproval}}
              <div class='approval-actions'>
                <BoxelButton
                  @kind='primary'
                  @size='small'
                  @loading={{this.approvalBusy}}
                  @disabled={{this.approvalBusy}}
                  {{on 'click' (fn this.decideApprovalStep 'approved')}}
                >Approve</BoxelButton>
                <BoxelButton
                  @kind='danger'
                  @size='small'
                  @loading={{this.approvalBusy}}
                  @disabled={{this.approvalBusy}}
                  {{on 'click' (fn this.decideApprovalStep 'rejected')}}
                >Reject</BoxelButton>
              </div>
            {{/if}}
            {{#if this.approvalError}}
              <p class='approval-error' role='alert'>{{this.approvalError}}</p>
            {{/if}}
          </aside>
        </div>
      </article>
      <style scoped>
        .offer-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --offer-id: var(--primary, var(--boxel-highlight));
          --offer-strong: color-mix(
            in oklch,
            var(--offer-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          background: var(--offer-strong);
          color: var(--background, var(--boxel-light));
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          margin-top: var(--boxel-sp-xs);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill.neutral {
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .hero-money {
          flex: none;
          text-align: right;
        }
        .money {
          display: block;
          font-size: 1.6rem;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .money-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          /* Fill whatever height is left so the aside's surface reaches the
             bottom edge. Without this the grid is only as tall as its content
             and the panel stops mid-card, reading as a cut-off seam. */
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        /* Ordered list, because the lifecycle genuinely is a sequence. */
        .timeline {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          gap: var(--boxel-sp);
          flex-wrap: wrap;
        }
        .step {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .step-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--border, var(--boxel-200));
          flex: none;
        }
        .step.done .step-dot {
          background: var(--offer-id);
        }
        .step.done .step-label {
          color: var(--foreground, var(--boxel-dark));
        }
        .step.current .step-label {
          font-weight: 700;
        }
        .step.negative .step-dot {
          background: var(--destructive, var(--boxel-danger));
        }
        .step.negative .step-label {
          /* --destructive is a SURFACE — its guaranteed pair is
             --destructive-foreground, not the card ground. Raw, it computes
             3.22:1 here, which fails body text. Mixed toward the card's own
             foreground it stays red-reading and legible in both themes. */
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 38%,
            var(--card-foreground, var(--boxel-dark))
          );
          font-weight: 700;
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 9rem 1fr;
        }
        .facts.stacked {
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding: 0.45rem var(--boxel-sp-xs) 0.45rem 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .facts.stacked dt {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .facts dd {
          margin: 0;
          padding: 0.45rem 0;
          font-size: var(--boxel-font-size-sm);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        .dd-note {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .linked {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .approval-actions {
          display: flex;
          gap: var(--boxel-sp-xs);
          margin-top: var(--boxel-sp-xs);
        }
        .approval-error {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-xs);
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 38%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
          .hero {
            flex-wrap: wrap;
          }
          .hero-money {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusStyle() {
      let c = stateColorOf(OFFER_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <div class='offer-embedded'>
        <span class='oe-icon'><HandshakeIcon class='oe-icon-svg' /></span>
        <div class='oe-main'>
          <span class='oe-title'>{{@model.title}}</span>
          {{#if @model.offeredTitle}}
            <span class='oe-role'>{{@model.offeredTitle}}</span>
          {{/if}}
        </div>
        {{#if @model.status}}
          <span
            class='oe-status'
            style={{this.statusStyle}}
          >{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .offer-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .oe-icon {
          display: inline-flex;
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .oe-icon-svg {
          width: 14px;
          height: 14px;
        }
        .oe-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .oe-title {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .oe-role {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .oe-status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='offer-atom'>
        <HandshakeIcon class='offer-atom-icon' />
        <span class='offer-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .offer-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .offer-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .offer-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusLabel(): string | undefined {
      return offerStatusLabel(this.args.model?.status);
    }

    get statusColor() {
      return stateColorOf(OFFER_STATUS_COLORS, this.args.model?.status);
    }
    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }
    get salaryLabel(): string | undefined {
      let v = this.args.model?.salary;
      return v != null ? `$${v.toLocaleString()}` : undefined;
    }
    get expiresLabel(): string | undefined {
      let date = this.args.model?.expirationDate;
      if (!date) {
        return undefined;
      }
      return `Expires ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    get lifecycleSteps() {
      // Mirrors the isolated view's rule: declined/rescinded can only happen
      // after 'extended', so those two statuses keep the earlier steps done
      // and append a terminated step, instead of blanking the whole bar.
      let order = ['draft', 'extended', 'accepted'];
      let status = this.args.model?.status;
      let terminal = status === 'declined' || status === 'rescinded';
      let idx = terminal
        ? order.indexOf('extended')
        : order.indexOf(status ?? '');
      let steps = order.map((step, i) => ({
        step,
        done: idx >= 0 && i <= idx,
        terminal: false,
      }));
      if (terminal) {
        steps.push({ step: status!, done: true, terminal: true });
      }
      return steps;
    }
    get initials() {
      return initialsOf(
        this.args.model?.candidateName || this.args.model?.title,
      );
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <span class='avatar' aria-hidden='true'>{{this.initials}}</span>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.offeredTitle}}
              <span class='fit-eb'>{{@model.offeredTitle}}</span>
            {{/if}}
          </div>
          {{! Status survives to the smallest tier. Terminal offers must never
              look like a fresh draft, so this is never the first thing cut. }}
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{this.statusLabel}}
            </span>
          {{/if}}
        </div>

        <div class='fit-track'>
          {{#if this.salaryLabel}}
            <span class='money'>{{this.salaryLabel}}</span>
          {{/if}}
          <div class='steps'>
            {{#each this.lifecycleSteps as |s|}}
              <i class='{{if s.done "on"}} {{if s.terminal "term"}}'></i>
            {{/each}}
          </div>
          {{#if this.expiresLabel}}
            <span class='track-label'>{{this.expiresLabel}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.positionTitle}}
            <div><dt>Role</dt><dd>{{@model.positionTitle}}</dd></div>
          {{/if}}
          {{#if @model.startDate}}
            <div><dt>Starts</dt><dd><@fields.startDate /></dd></div>
          {{/if}}
          {{#if @model.equity}}
            <div><dt>Equity</dt><dd>{{@model.equity}}</dd></div>
          {{/if}}
          {{#if @model.candidateName}}
            <div><dt>For</dt><dd>{{@model.candidateName}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields; 11px floor; status pill always on. */
        .fit {
          height: 100%;
          /* Flex, not a three-row grid: with `minmax(0, 1fr)` in the middle
             a taller bottom block squeezed the middle row and clipped its
             text. Here the middle keeps its natural height and the extras
             block is pushed to the bottom by `margin-top: auto`. */
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --offer-id: var(--primary, var(--boxel-highlight));
          --offer-strong: color-mix(
            in oklch,
            var(--offer-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--offer-strong);
          color: var(--background, var(--boxel-light));
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-pill {
          flex: none;
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-track {
          flex: none;
          display: none;
        }
        .money {
          display: block;
          font-size: calc(var(--fit-name) * 1.25);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .steps {
          display: flex;
          gap: 3px;
          margin-top: 0.2rem;
        }
        .steps i {
          height: 4px;
          flex: 1;
          border-radius: 2px;
          background: var(--border, var(--boxel-200));
        }
        .steps i.on {
          background: var(--offer-id);
        }
        .steps i.term {
          background: var(--destructive, var(--boxel-danger));
        }
        .track-label {
          display: block;
          margin-top: 0.15rem;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-add > div {
          display: flex;
          gap: 0.25rem;
          min-width: 0;
        }
        .fit-add dt {
          flex: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-variant-numeric: tabular-nums;
        }

        /* TIER 2 — add the offered title. Two rules: no `or` in CQ. */
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }
        /* TIER 3 — add salary, lifecycle track and expiry. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-track {
            display: block;
          }
        }
        /* TIER 4 — width-driven facts; previously missing entirely. */
        @container fitted-card (height > 150px) and (width > 180px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }
        @container fitted-card (height <= 90px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-pill {
            align-self: center;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height <= 50px) {
          .avatar {
            width: 1.25rem;
            height: 1.25rem;
          }
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
