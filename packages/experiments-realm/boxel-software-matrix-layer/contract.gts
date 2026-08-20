import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { and } from '@cardstack/boxel-ui/helpers';
import { codeRef, type getCards } from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import enumField from 'https://cardstack.com/base/enum';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import MarkdownField from 'https://cardstack.com/base/markdown';
import ContractIcon from '@cardstack/boxel-icons/contract';
import Theme from 'https://cardstack.com/base/theme';
import { Account } from './account';
import { Opportunity } from './opportunity';
import { formatMoney } from './money';
import { Employee } from './employee';
import { ApprovalChainField } from './approval-chain-field';
import { ContractStatusField, contractStatusLabel } from './contract-status';
import { RiskRatingField } from './contract-risk';

import {
  ContractTypeField,
  contractTypeLabel,
} from './contract-type';

// @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
const here: string = import.meta.url;

/**
 * Query refs for the two cards that link UP to this one.
 *
 * Built with `codeRef` rather than `identifyCard(ContractClause)` because
 * importing those classes here is a STATIC module-level cycle: evaluating
 * contract.gts immediately evaluates contract-clause.gts, which re-enters
 * contract.gts before `Contract` is defined. The child's `linksTo(() =>
 * Contract)` thunk does not save it — the thunk defers the FIELD reference, not
 * the module evaluation. That is the "cardOrThunk was undefined" failure.
 *
 * `codeRef` resolves './contract-clause' against this module's own URL, so the
 * query gets a real ref with no import edge at all.
 */
const CONTRACT_CLAUSE_REF = codeRef(here, './contract-clause', 'ContractClause');
const OBLIGATION_REF = codeRef(here, './obligation', 'Obligation');

const MS_PER_DAY = 86_400_000;

/** Whole days from today to `date`; negative once the date has passed. */
function daysUntil(date?: Date | string | null): number | undefined {
  if (!date) return undefined;
  let t = new Date(date);
  if (!Number.isFinite(t.getTime())) return undefined;
  let now = new Date();
  let a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * `YYYY-MM-DD` built from local calendar parts.
 *
 * Not `toISOString()`: a notice deadline is a calendar day, and
 * `new Date('2026-10-13').toISOString()` yields the 12th anywhere east of UTC.
 * A notice served one day late is a renewal nobody chose.
 */
function calendarDay(d: Date): string {
  let m = `${d.getMonth() + 1}`.padStart(2, '0');
  let day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * What the e-signature provider last told us.
 *
 * A closed set even though this app cannot send a request — the values arrive
 * from outside, and the point of naming them here is that the app knows what
 * it is allowed to be told.
 */
export const SignatureStatusField = enumField(StringField, {
  options: [
    { value: 'not_sent', label: 'Not sent' },
    { value: 'pending', label: 'Out for signature' },
    { value: 'signed', label: 'Signed' },
    { value: 'declined', label: 'Declined' },
    { value: 'voided', label: 'Voided' },
  ],
  displayName: 'Signature Status',
});

export class Contract extends CardDef {
  static displayName = 'Contract';
  static icon = ContractIcon;

  @field title = contains(StringField);
  @field account = linksTo(Account);

  // Theme inheritance. CardDef's default computes this from cardInfo.theme alone,
  // so a contract opened from the app lands in a NEW stack with no theme at all —
  // the DOM cascade the app relied on does not cross a stack boundary. Falling back
  // to the account's own cardTheme makes the link a data-model edge instead, which
  // does. And because Account computes its cardTheme the same way, the chain keeps
  // walking upward on its own.
  @field cardTheme = linksTo(() => Theme, {
    computeVia: function (this: Contract) {
      return this.cardInfo?.theme ?? this.account?.cardTheme;
    },
  });
  // Typed against Opportunity so a Deal — or any future subtype — is
  // assignable, the same reason owner links to User rather than Teammate.
  @field deal = linksTo(Opportunity);
  @field status = contains(ContractStatusField);
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field value = contains(AmountWithCurrency);
  // The event fact behind "signed": a date that is written once, so the
  // signature survives a later status change and can be reported on.
  @field signedAt = contains(DateField);

  /**
   * The contract's own text, so search reaches INSIDE the agreement rather than
   * only across its fields.
   *
   * The realm indexes field values into `search_doc`, so putting the body in a
   * field is what makes "indemnity" findable at all — a PDF at `documentUrl`
   * is opaque to the index. Populated by paste or by extraction; nothing here
   * parses the PDF, and pretending otherwise would be the interesting lie.
   */
  @field fullText = contains(MarkdownField);

  /**
   * E-SIGNATURE SEAM — status tracked here, sending owned elsewhere.
   *
   * BLOCKED, with evidence. The spec assigns the e-signature app to a
   * colleague ("implementation details TBD"), so this app has nothing to call.
   * What it CAN own honestly is the state: which request is outstanding, what
   * came back, and where the executed copy landed.
   *
   * Deliberately no "Send for signature" button. A control that looks like it
   * dispatches a signing request and does not is worse than no control, because
   * the failure is silent and only discovered when nobody signs.
   */
  /**
   * Drives the spec's data-sensitivity approval rule:
   *
   *     IF data_handling = "Sensitive PII" THEN [Legal] -> [Security] -> [DPO]
   *
   * A boolean rather than a category, because the routing question is binary:
   * either the DPO must see it or they must not. Grading sensitivity finer
   * would invite rules that disagree about where the line sits.
   */
  @field handlesSensitiveData = contains(BooleanField);

  @field signatureStatus = contains(SignatureStatusField);
  @field signatureRequestedAt = contains(DateField);
  @field signatureProvider = contains(StringField);
  @field executedCopyUrl = contains(UrlField);
  @field terms = contains(MarkdownField);
  // Where the executed copy lives. Most teams sign in DocuSign or similar, so
  // the record points at the artifact rather than trying to hold it.
  @field documentUrl = contains(UrlField);

  @field isSigned = contains(BooleanField, {
    computeVia: function (this: Contract) {
      return Boolean(this.signedAt);
    },
  });

  @field daysToExpiry = contains(NumberField, {
    computeVia: function (this: Contract) {
      if (!this.endDate || this.status === 'terminated') return 0;
      let days = Math.ceil(
        (new Date(this.endDate).getTime() - Date.now()) / 86400000,
      );
      return days > 0 ? days : 0;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Contract) {
      return this.title?.trim()?.length
        ? this.title
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  // ---- Contract lifecycle management (app5) ------------------------------
  // Additive only. Every field below is optional and every derived value is
  // `computeVia`, so Contract instances written before this extension
  // deserialize unchanged and the CRM-side consumers keep working.

  @field contractNumber = contains(StringField);
  @field contractType = contains(ContractTypeField);
  /** Internal owner — who answers for this contract. */
  @field owner = linksTo(() => Employee);

  @field autoRenews = contains(BooleanField);
  @field renewalNoticeDays = contains(NumberField);

  @field risk = contains(RiskRatingField);
  @field approvalChain = contains(ApprovalChainField);

  // NO `clauses` / `obligations` link arrays here, deliberately.
  //
  // ContractClause and Obligation each link UP to their contract, and the app
  // reads them back with a live query filtered on that link. Two reasons:
  // obligations are unbounded and reporting-flavoured, which the block-factory
  // rollup rule says must be a query rather than a link array on the hot
  // parent card; and a back-link here would put Contract in an import cycle
  // with both modules, which is what produced the
  // "cardOrThunk was undefined" load failure.
  /** Set on an amendment; the lineage is walked from here to the root. */
  @field parentContract = linksTo(() => Contract);

  @field termMonths = contains(NumberField, {
    computeVia: function (this: Contract) {
      if (!this.startDate || !this.endDate) return undefined;
      let a = new Date(this.startDate);
      let b = new Date(this.endDate);
      if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) {
        return undefined;
      }
      let months =
        (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
      return months > 0 ? months : undefined;
    },
  });

  /**
   * The date notice must be served by to stop an auto-renewal.
   *
   * This is the date the app exists to surface: the expiry is common
   * knowledge, the notice deadline is the one that quietly passes.
   */
  @field noticeBy = contains(StringField, {
    computeVia: function (this: Contract) {
      if (!this.endDate || !this.autoRenews) return undefined;
      let days = this.renewalNoticeDays;
      if (typeof days !== 'number' || !Number.isFinite(days)) return undefined;
      let end = new Date(this.endDate);
      if (!Number.isFinite(end.getTime())) return undefined;
      return calendarDay(
        new Date(end.getFullYear(), end.getMonth(), end.getDate() - days),
      );
    },
  });

  @field daysToNotice = contains(NumberField, {
    computeVia: function (this: Contract) {
      return daysUntil(this.noticeBy);
    },
  });

  /**
   * Mirrors `risk.grade` onto the card.
   *
   * A nested field is not directly filterable, and the repository has to answer
   * "show me the critical contracts" — so the grade is lifted to a real indexed
   * field. It stays computed, so it cannot disagree with the scorecard it came
   * from.
   */
  @field riskGrade = contains(StringField, {
    computeVia: function (this: Contract) {
      return this.risk?.grade;
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: Contract) {
      return [contractTypeLabel(this.contractType), contractStatusLabel(this.status)]
        .filter(Boolean)
        .join(' \u00b7 ');
    },
  });

  static atom = class Atom extends Component<typeof Contract> {
    <template>
      <span class='contract-atom'>
        <ContractIcon class='ca-icon' />
        <span class='ca-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .contract-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          min-width: 0;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .ca-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .ca-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Contract> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    <template>
      <div class='contract'>
        <ContractIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.account.name}}
            <span class='meta'>{{@model.account.name}}</span>
          {{/if}}
        </div>
        <span class='figure'>{{if this.valueDisplay this.valueDisplay '—'}}</span>
        {{#if @model.status}}
          <span
            class='status status-{{this.statusSlug}}'
          >{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .contract {
        /* Status hues are DATA — red means overdue whatever the theme — so the hue is
           declared here rather than pulled from a semantic token. These tokens were
           REFERENCED but never declared, so their hex fallback was the only value that
           ever rendered (boxel-theming C2).
           The fill is the part that must not be fixed: a literal #fee2e2 stays pale on
           a dark theme while its text darkens, and the pair silently fails. So the text
           colour is pulled toward the theme's own --foreground, and the fill is then
           diluted out of THAT text colour — measured 6.3–7.6:1 in both light and dark. */
        --state-overdue-fg: color-mix(in oklch, oklch(0.55 0.19 27) 65%, var(--foreground));
        --state-overdue-bg: color-mix(in oklch, var(--state-overdue-fg) 12%, var(--background));
        --state-partial-fg: color-mix(in oklch, oklch(0.60 0.14 60) 65%, var(--foreground));
        --state-partial-bg: color-mix(in oklch, var(--state-partial-fg) 12%, var(--background));
        --state-positive-fg: color-mix(in oklch, oklch(0.55 0.13 152) 65%, var(--foreground));
        --state-positive-bg: color-mix(in oklch, var(--state-positive-fg) 12%, var(--background));
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
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
        .figure {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .status {
          width: 7.5rem;
          text-align: center;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .status-signed {
          background: var(--state-positive-bg);
          color: var(--state-positive-fg);
        }
        .status-out-for-signature {
          background: var(--state-partial-bg);
          color: var(--state-partial-fg);
        }
        .status-expired,
        .status-terminated {
          background: var(--state-overdue-bg);
          color: var(--state-overdue-fg);
        }
      </style>
    </template>

    get statusSlug() {
      return (this.args.model?.status ?? '').replace(/\s+/g, '-');
    }
  };

  static fitted = class Fitted extends Component<typeof Contract> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get statusSlug() {
      return (this.args.model?.status ?? '').replace(/\s+/g, '-');
    }
    get expiryNote() {
      let days = this.args.model?.daysToExpiry;
      if (!days) return '';
      return days === 1 ? 'ends tomorrow' : `${days} days left`;
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <ContractIcon class='icon' />
          {{#if @model.status}}
            <span
              class='status status-{{this.statusSlug}}'
            >{{@model.status}}</span>
          {{/if}}
        </div>
        <span class='name'>{{@model.cardTitle}}</span>
        {{#if this.valueDisplay}}
          <span class='figure'>{{this.valueDisplay}}</span>
        {{/if}}
        {{#if @model.account.name}}
          <span class='meta line-account'>{{@model.account.name}}</span>
        {{/if}}
        {{#if this.expiryNote}}
          <span class='meta line-expiry'>{{this.expiryNote}}</span>
        {{/if}}
        {{#if @model.startDate}}
          <span class='meta line-term'>Term
            <@fields.startDate />
            –
            <@fields.endDate /></span>
        {{/if}}
        {{#if @model.deal.name}}
          <span class='meta line-deal'>from {{@model.deal.name}}</span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
        /* Status hues are DATA — red means overdue whatever the theme — so the hue is
           declared here rather than pulled from a semantic token. These tokens were
           REFERENCED but never declared, so their hex fallback was the only value that
           ever rendered (boxel-theming C2).
           The fill is the part that must not be fixed: a literal #fee2e2 stays pale on
           a dark theme while its text darkens, and the pair silently fails. So the text
           colour is pulled toward the theme's own --foreground, and the fill is then
           diluted out of THAT text colour — measured 6.3–7.6:1 in both light and dark. */
        --state-overdue-fg: color-mix(in oklch, oklch(0.55 0.19 27) 65%, var(--foreground));
        --state-overdue-bg: color-mix(in oklch, var(--state-overdue-fg) 12%, var(--background));
        --state-partial-fg: color-mix(in oklch, oklch(0.60 0.14 60) 65%, var(--foreground));
        --state-partial-bg: color-mix(in oklch, var(--state-partial-fg) 12%, var(--background));
        --state-positive-fg: color-mix(in oklch, oklch(0.55 0.13 152) 65%, var(--foreground));
        --state-positive-bg: color-mix(in oklch, var(--state-positive-fg) 12%, var(--background));
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          padding: 0.625rem 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .icon {
          width: 16px;
          height: 16px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .status {
          line-height: 1.25;
          margin-left: auto;
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.0625rem 0.375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .status-signed {
          background: var(--state-positive-bg);
          color: var(--state-positive-fg);
        }
        .status-out-for-signature {
          background: var(--state-partial-bg);
          color: var(--state-partial-fg);
        }
        .status-expired,
        .status-terminated {
          background: var(--state-overdue-bg);
          color: var(--state-overdue-fg);
        }
        .name {
          /* Truncate at a line boundary, never mid-glyph: the reader must
             see an ellipsis rather than half a letter. */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.25;
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .figure {
          white-space: nowrap;
          line-height: 1.25;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .meta {
          line-height: 1.25;
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-account,
        .line-expiry,
        .line-term,
        .line-deal {
          display: none;
        }
        /* Each taller tier adds a line rather than just unhiding one, so a
           tile-sized render fills its box instead of trailing off. */
        @container fitted-card (min-height: 170px) {
          .line-account,
          .line-expiry {
            display: block;
          }
          /* Anchors the meta block to the bottom so a tall tile reads as a
             composed card rather than content trailing off at the top. */
          .line-account {
            margin-top: auto;
          }
        }
        @container fitted-card (min-height: 215px) {
          .line-term {
            display: block;
          }
        }
        @container fitted-card (min-width: 300px) and (min-height: 170px) {
          .line-deal {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Contract> {
    // Clauses and obligations link UP to their contract; there is no link array
    // on this card to read back (see the note on the field list). So the detail
    // page asks the realm the reverse question instead — the same idiom
    // carrier.gts uses to find the shipments pointing at it.
    private clauseQuery: ReturnType<getCards> | undefined;
    private obligationQuery: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      let byContract = (ref: any) => () => {
        let id = this.args.model?.id;
        if (!id) return undefined;
        return { filter: { on: ref, every: [{ eq: { 'contract.id': id } }] } };
      };
      this.clauseQuery = this.args.context?.getCards(
        this,
        byContract(CONTRACT_CLAUSE_REF),
        () => this.realms,
        { isLive: true },
      );
      this.obligationQuery = this.args.context?.getCards(
        this,
        byContract(OBLIGATION_REF),
        () => this.realms,
        { isLive: true },
      );
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    get clauses(): any[] {
      return ((this.clauseQuery as any)?.instances ?? []).filter(Boolean);
    }
    get obligations(): any[] {
      return ((this.obligationQuery as any)?.instances ?? []).filter(Boolean);
    }

    // A live query resolving after first paint is how a card comes to assert
    // "no clauses" about data it has not received yet. Guarded on emptiness too,
    // so a background refresh of a populated list does not flash a skeleton.
    // A contract the CRM created has no clauses or obligations and never will,
    // so it must not flash "Loading clauses and obligations…" on every page
    // view. The CLM markers are what say this contract is managed here and is
    // therefore worth waiting on.
    get isClmManaged(): boolean {
      let m = this.args.model;
      return Boolean(
        m?.contractNumber || m?.riskGrade || m?.approvalChain?.steps?.length,
      );
    }

    get isLoadingLinked() {
      let c = this.clauseQuery as any;
      let o = this.obligationQuery as any;
      return (
        (Boolean(c?.isLoading) || Boolean(o?.isLoading)) &&
        !this.clauses.length &&
        !this.obligations.length
      );
    }

    // Without reading `errors` a failed query is indistinguishable from an empty
    // realm, and the section would claim "there are none" when the truth is
    // "we could not look".
    get queryFailed(): boolean {
      let e1 = (this.clauseQuery as any)?.errors as any[] | undefined;
      let e2 = (this.obligationQuery as any)?.errors as any[] | undefined;
      return Boolean(e1?.length || e2?.length);
    }

    get deviations(): any[] {
      return this.clauses.filter((c) => c.isDeviation);
    }
    get deviationLabel(): string {
      let n = this.deviations.length;
      return `${n} deviation${n === 1 ? '' : 's'}`;
    }
    get overdue(): any[] {
      return this.obligations.filter((o) => o.status === 'overdue');
    }

    @action openCard(card: any) {
      (this.args as any).viewCard?.(card, 'isolated');
    }

    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get statusSlug() {
      return (this.args.model?.status ?? '').replace(/\s+/g, '-');
    }
    <template>
      <article class='contract-page'>
        <header class='ch'>
          <div class='ch-id'>
            <p class='doc-kind'>Contract</p>
            <h1>{{@model.cardTitle}}</h1>
            {{#if @model.isSigned}}
              <p class='status-line signed'>Signed
                <@fields.signedAt /></p>
            {{else}}
              <p class='status-line'>{{if
                  @model.status
                  @model.status
                  'Not yet signed'
                }}</p>
            {{/if}}
          </div>
          {{#if this.valueDisplay}}
            <p class='ch-value'>{{this.valueDisplay}}</p>
          {{/if}}
        </header>

        <section class='panel'>
          <h2>Agreement</h2>
          <dl>
            {{#if @model.contractNumber}}
              <dt>Reference</dt>
              <dd class='mono'>{{@model.contractNumber}}</dd>
            {{/if}}
            {{#if @model.contractType}}
              <dt>Type</dt>
              <dd><@fields.contractType @format='atom' /></dd>
            {{/if}}
            {{#if @model.account}}
              <dt>Account</dt>
              <dd><@fields.account @format='embedded' /></dd>
            {{/if}}
            {{#if @model.deal}}
              <dt>Deal</dt>
              <dd><@fields.deal @format='atom' /></dd>
            {{/if}}
            {{#if @model.startDate}}
              <dt>Term begins</dt>
              <dd><@fields.startDate /></dd>
            {{/if}}
            {{#if @model.endDate}}
              <dt>Term ends</dt>
              <dd><@fields.endDate />
                {{#if @model.daysToExpiry}}
                  <span class='hint'>{{@model.daysToExpiry}} days left</span>
                {{/if}}
              </dd>
            {{/if}}
            {{#if @model.noticeBy}}
              <dt>Notice by</dt>
              <dd class='mono'>{{@model.noticeBy}}
                {{#if @model.daysToNotice}}
                  <span class='hint'>{{@model.daysToNotice}} days to act</span>
                {{/if}}
              </dd>
            {{/if}}
            {{#if @model.owner}}
              <dt>Owner</dt>
              <dd><@fields.owner @format='atom' /></dd>
            {{/if}}
            {{#if @model.documentUrl}}
              <dt>Executed copy</dt>
              <dd><@fields.documentUrl /></dd>
            {{/if}}
          </dl>
        </section>

        {{#if @model.riskGrade}}
          <section class='panel'>
            <h2>Risk</h2>
            <@fields.risk @format='embedded' />
          </section>
        {{/if}}

        {{#if @model.approvalChain.steps.length}}
          <section class='panel'>
            <h2>Approval</h2>
            <@fields.approvalChain @format='embedded' />
          </section>
        {{/if}}

        {{#if this.queryFailed}}
          <section class='panel'>
            <p class='qnote' role='status'>Could not load this contract's clauses
              and obligations. This is a failed lookup, not an empty record —
              reload before concluding there are none.</p>
          </section>
        {{else if (and this.isClmManaged this.isLoadingLinked)}}
          <section class='panel'>
            <p class='qnote' role='status'>Loading clauses and obligations…</p>
          </section>
        {{else}}
          {{#if this.clauses.length}}
            <section class='panel'>
              <h2>Clauses
                {{#if this.deviations.length}}
                  <span class='count-warn'>{{this.deviationLabel}}</span>
                {{/if}}
              </h2>
              <ul class='linked'>
                {{#each this.clauses as |c|}}
                  <li>
                    <button
                      type='button'
                      class='linked-row'
                      {{on 'click' (fn this.openCard c)}}
                    >{{c.cardTitle}}<span class='linked-meta'
                      >{{c.cardDescription}}</span></button>
                  </li>
                {{/each}}
              </ul>
            </section>
          {{/if}}

          {{#if this.obligations.length}}
            <section class='panel'>
              <h2>Obligations
                {{#if this.overdue.length}}
                  <span class='count-warn'>{{this.overdue.length}} overdue</span>
                {{/if}}
              </h2>
              <ul class='linked'>
                {{#each this.obligations as |o|}}
                  <li>
                    <button
                      type='button'
                      class='linked-row'
                      {{on 'click' (fn this.openCard o)}}
                    >{{o.cardTitle}}<span class='linked-meta'>{{o.cardDescription}}
                        {{#if o.nextDueDate}}· due {{o.nextDueDate}}{{/if}}</span>
                    </button>
                  </li>
                {{/each}}
              </ul>
            </section>
          {{/if}}
        {{/if}}

        {{#if @model.terms}}
          <section class='panel'>
            <h2>Terms</h2>
            <div class='terms'><@fields.terms /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .mono {
        /* Status hues are DATA — red means overdue whatever the theme — so the hue is
           declared here rather than pulled from a semantic token. These tokens were
           REFERENCED but never declared, so their hex fallback was the only value that
           ever rendered (boxel-theming C2).
           The fill is the part that must not be fixed: a literal #fee2e2 stays pale on
           a dark theme while its text darkens, and the pair silently fails. So the text
           colour is pulled toward the theme's own --foreground, and the fill is then
           diluted out of THAT text colour — measured 6.3–7.6:1 in both light and dark. */
        --state-positive-fg: color-mix(in oklch, oklch(0.55 0.13 152) 65%, var(--foreground));
        --state-positive-bg: color-mix(in oklch, var(--state-positive-fg) 12%, var(--background));
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .qnote {
          margin: 0;
          font-size: 0.85rem;
          color: var(--muted-foreground, #666666);
        }
        .count-warn {
          margin-left: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--destructive, #b3261e);
        }
        .linked {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .linked-row {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.1rem;
          width: 100%;
          text-align: left;
          font: inherit;
          cursor: pointer;
          padding: 0.4rem 0.55rem;
          border: 1px solid var(--border, #dddddd);
          border-radius: 4px;
          background: var(--card, #ffffff);
          color: inherit;
        }
        .linked-row:hover {
          border-color: var(--foreground, #111111);
        }
        .linked-meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #666666);
        }
        .contract-page {
          /* An isolated card gets NO container from the host — every ancestor
             up to the stack panel is `container-type: normal`, so an
             `@container` rule here is inert until this declares its own.
             `inline-size`, not `size`: the card scrolls, and `size` needs a
             definite block size and would collapse the column. */
          container-type: inline-size;
          container-name: contract-page;
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          color: var(--foreground, #111111);
        }
        .ch {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
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
          font-family: var(--font-heading, inherit);
        }
        .status-line {
          margin: 0.25rem 0 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
          text-transform: capitalize;
        }
        .status-line.signed {
          color: var(--state-positive-fg);
          font-weight: 600;
        }
        .ch-value {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-family: var(--font-heading, inherit);
          white-space: nowrap;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 8px;
          padding: 1rem 1.125rem;
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
          grid-template-columns: 9rem 1fr;
          gap: 0.5rem 1rem;
          font-size: 0.875rem;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
        .hint {
          margin-left: 0.5rem;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .terms {
          font-size: 0.875rem;
          line-height: 1.6;
        }
      
        /* Below this the two-up rows stop being side-by-side; the panel gets
           narrow whenever a second card opens beside this one. */
        @container contract-page (width < 620px) {
          .panel dl {
            grid-template-columns: 1fr;
          }
          .ch {
            flex-direction: column;
            align-items: flex-start;
          }
        }
</style>
    </template>
  };
}
