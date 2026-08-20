import {
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import UrlField from '@cardstack/base/url';
import SignatureIcon from '@cardstack/boxel-icons/signature';
import ScaleIcon from '@cardstack/boxel-icons/scale';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';
import UsersIcon from '@cardstack/boxel-icons/users';

import { ContractTypeField, contractTypeLabel } from './contract-type';
import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import { formatMoney } from './money';

/**
 * Who may legally bind the company, and up to what number.
 *
 * A signatory is NOT an approver, and conflating the two is how a contract
 * ends up approved by three people and signed by nobody entitled to sign it.
 * Approval is internal oversight — did the right functions review this.
 * Signature is legal capacity — does this person's authority actually reach
 * this contract's value and type.
 *
 * The block earns its place on one method: `canSign`. Everything else here is
 * the data that method needs.
 */

export interface SigningVerdict {
  allowed: boolean;
  /** Plain-English reason, written for the person who has to act on it. */
  reason: string;
}

export class Signatory extends CardDef {
  static displayName = 'Signatory';
  static icon = SignatureIcon;

  @field person = linksTo(() => Employee);
  /** The title they sign under — it appears on the executed document. */
  @field signingTitle = contains(StringField);

  /**
   * The most they may bind, inclusive.
   *
   * Inclusive matters and is stated rather than assumed: a $250,000 authority
   * signing a $250,000 contract is the single most common edge in this whole
   * app, and a strict comparison would block it silently.
   */
  @field signatureAuthority = contains(AmountWithCurrency);

  /** Which contract types they may sign. Empty means all types. */
  @field contractTypes = containsMany(ContractTypeField);

  /** Specimen signature image, when one is held. */
  @field specimenUrl = contains(UrlField);
  @field isActive = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Signatory) {
      return this.signingTitle?.trim()?.length
        ? this.signingTitle
        : 'Signatory';
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: Signatory) {
      let types = (this.contractTypes ?? []).filter(Boolean);
      let scope = types.length
        ? types.map((t) => contractTypeLabel(t)).join(', ')
        : 'All contract types';
      let cap = this.signatureAuthority?.amount;
      // Raw digits read as a typo on a governance screen — "up to 1000000"
      // and "up to $1,000,000" are the same number and not the same message.
      let money = formatMoney(cap, this.signatureAuthority?.currency?.code);
      return money ? `${scope} · up to ${money}` : scope;
    },
  });

  /**
   * May this signatory bind a contract of this value and type?
   *
   * Deliberately returns a reason as well as a boolean. A bare `false` on a
   * signing screen tells the user they are stuck without telling them who to
   * route to, which is the difference between a check and an obstruction.
   *
   * Both arguments are supplied by the caller rather than read off a linked
   * Contract: the check has to run *before* anything is sent, including on a
   * contract that has not been created yet.
   */
  canSign(value?: number | null, contractType?: string | null): SigningVerdict {
    if (this.isActive === false) {
      return { allowed: false, reason: 'This signatory is no longer active.' };
    }
    let types = (this.contractTypes ?? []).filter(Boolean);
    if (types.length && contractType && !types.includes(contractType)) {
      return {
        allowed: false,
        reason: `Not authorised for ${contractTypeLabel(contractType)} contracts.`,
      };
    }
    let cap = this.signatureAuthority?.amount;
    if (typeof cap !== 'number' || !Number.isFinite(cap)) {
      return {
        allowed: false,
        reason: 'No signing authority has been set for this signatory.',
      };
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > cap) {
      return {
        allowed: false,
        reason: `Authorised to ${cap}; this contract is ${value}. Route to a higher authority.`,
      };
    }
    return { allowed: true, reason: `Within authority of ${cap}.` };
  }


  /**
   * Attribute-only by design: prerendered fitted does NOT resolve `linksTo`,
   * so reaching for `person` here is what makes the card render as
   * "Card Error" inside a grid. Everything shown below is a plain attribute or
   * a computed string.
   */

  /**
   * The domain question: "can this person sign THIS contract?"
   *
   * The authority ceiling is therefore the hero figure — it is the number a
   * router checks before sending anything, and the one that stops a $600K
   * agreement going to a $250K signer.
   */
  static isolated = class Isolated extends Component<typeof Signatory> {
    get cap(): string {
      return (
        formatMoney(
          this.args.model?.signatureAuthority?.amount,
          this.args.model?.signatureAuthority?.currency?.code,
        ) || '—'
      );
    }
    get types(): string[] {
      return (this.args.model?.contractTypes ?? []).filter(Boolean) as string[];
    }
    get scopeLabels(): string[] {
      return this.types.length
        ? this.types.map((t) => contractTypeLabel(t))
        : ['All contract types'];
    }
    get inactive() {
      return this.args.model?.isActive === false;
    }
    <template>
      <article class='sg-page'>
        <header class='hero'>
          <div class='hero-id'>
            <p class='kicker'><SignatureIcon role='presentation' />Signing authority</p>
            <h1>{{@model.signingTitle}}</h1>
            {{#if @model.person}}
              <div class='who'><@fields.person @format='atom' @displayContainer={{false}} /></div>
            {{/if}}
            {{#if this.inactive}}
              <StatePill @label='Inactive' @hue='red' @dot={{true}} />
            {{/if}}
          </div>
          <div class='hero-figure'>
            <span class='fig-n'>{{this.cap}}</span>
            <span class='fig-u'>maximum, inclusive</span>
          </div>
        </header>

        <section class='panel'>
          <h2><ScaleIcon role='presentation' />May sign</h2>
          <ul class='scope'>
            {{#each this.scopeLabels as |label|}}
              <li>{{label}}</li>
            {{/each}}
          </ul>
        </section>

        <section class='panel'>
          <h2><ShieldCheckIcon role='presentation' />How this is applied</h2>
          <p class='guidance'>A contract at or below
            <strong>{{this.cap}}</strong>
            of a permitted type may be routed here. Above it, or outside that
            list, the request is refused with the reason and the router sends it
            to a higher authority — the check runs before anything is sent, not
            after it comes back signed.</p>
        </section>

        {{#if @model.specimenUrl}}
          <section class='panel'>
            <h2><UsersIcon role='presentation' />Specimen</h2>
            <a class='specimen' href={{@model.specimenUrl}} target='_blank' rel='noopener noreferrer'>
              View specimen signature</a>
          </section>
        {{/if}}
      </article>

      <style scoped>
        .sg-page {
          container-type: inline-size;
          container-name: sg-page;
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
        .who { font-size: var(--boxel-font-size-sm); }
        .hero-figure { flex: none; text-align: right; line-height: 1; }
        /* Money keeps its minor units — a signing ceiling missing a digit is
           the difference between $250,000 and $25,000. */
        .fig-n {
          display: block; font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums; font-size: 1.45rem; font-weight: 600;
          letter-spacing: -0.03em; white-space: nowrap;
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
        .scope {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-wrap: wrap; gap: 6px;
        }
        .scope li {
          font-size: var(--boxel-font-size-sm); font-weight: 600;
          padding: 3px 10px; border-radius: 4px;
          background: color-mix(in oklch, var(--foreground, #111) 7%, transparent);
        }
        .guidance {
          margin: 0; font-size: var(--boxel-font-size-sm);
          line-height: 1.55; max-width: 68ch;
        }
        .specimen { font-size: var(--boxel-font-size-sm); }
        @container sg-page (width < 560px) {
          .hero { flex-direction: column; align-items: flex-start; gap: var(--boxel-sp); }
          .hero-figure { text-align: left; }
          .fig-n { font-size: 2.1rem; }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Signatory> {
    <template>
      <article class='sg-fit'>
        <header class='sf-head'>
          <SignatureIcon class='sf-icon' role='presentation' />
          <h3 class='sf-title'>{{@model.signingTitle}}</h3>
        </header>
        <p class='sf-scope'>{{@model.cardDescription}}</p>
        <footer class='sf-foot'>
          {{#if @model.signatureAuthority.amount}}
            <span class='sf-cap'><@fields.signatureAuthority @format='atom' /></span>
          {{else}}
            <span class='sf-none'>No authority set</span>
          {{/if}}
        </footer>
      </article>
      <style scoped>
        .sg-fit {
          --pad: clamp(6px, calc(2px + 1.7cqi), 13px);
          width: 100%;
          height: 100%;
          padding: var(--pad);
          overflow: hidden;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 3px;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .sf-head {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .sf-icon {
          width: clamp(12px, 3cqi, 16px);
          height: clamp(12px, 3cqi, 16px);
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sf-title {
          margin: 0;
          font-size: clamp(12px, min(4.2cqi, 15cqb), 17px);
          font-weight: 600;
          line-height: 1.15;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sf-scope {
          margin: 0;
          font-size: max(10px, min(3cqi, 12px));
          line-height: 1.35;
          color: var(--muted-foreground, var(--boxel-450));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .sf-foot {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: max(10px, min(3cqi, 12px));
          font-weight: 600;
        }
        .sf-none {
          color: var(--muted-foreground, var(--boxel-450));
          font-weight: 400;
        }
        /* Badge tier: the title alone still identifies the row. */
        @container fitted-card (height <= 50px) {
          .sg-fit { grid-template-rows: auto; }
          .sf-scope, .sf-foot { display: none; }
        }
        @container fitted-card (50px < height <= 80px) {
          .sf-scope { display: none; }
        }
        @container fitted-card (width <= 150px) {
          .sf-icon { display: none; }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Signatory> {
    <template>
      <span class='sg-atom'>
        <SignatureIcon class='sg-icon' role='presentation' />
        {{#if @model.person}}
          <@fields.person @format='atom' @displayContainer={{false}} />
        {{else}}
          <span class='sg-none'>Unassigned</span>
        {{/if}}
      </span>
      <style scoped>
        .sg-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxxs);
        }
        .sg-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sg-none {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Signatory> {
    get scope() {
      let types = (this.args.model?.contractTypes ?? []).filter(Boolean);
      return types.length
        ? types.map((t: string) => contractTypeLabel(t)).join(' · ')
        : 'All contract types';
    }
    <template>
      <article class='sg-row'>
        <div class='sg-main'>
          {{#if @model.person}}
            <@fields.person @format='atom' @displayContainer={{false}} />
          {{/if}}
          <p class='sg-title'>{{@model.signingTitle}}</p>
        </div>
        <div class='sg-slot'>
          <span class='sg-lbl'>Authority</span>
          {{#if @model.signatureAuthority.amount}}
            <@fields.signatureAuthority @format='atom' />
          {{else}}
            <span class='sg-dash'>—</span>
          {{/if}}
        </div>
        <p class='sg-scope'>{{this.scope}}</p>
        {{#unless @model.isActive}}
          <StatePill @label='Inactive' @hue='slate' @dot={{true}} />
        {{/unless}}
      </article>
      <style scoped>
        .sg-row {
        /* The host wraps a linked card in a CardContainer that draws a
           boundary and deliberately adds NO padding (base/field-component.gts),
           because padding there would shift the container-query breakpoints the
           inner card reasons about. So the inset has to come from here, or the
           text sits flush against the pill the host draws. */
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          display: grid;
          grid-template-columns: minmax(0, 1fr) 108px;
          gap: var(--boxel-sp-xs);
          align-items: center;
        }
        .sg-title {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sg-slot {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          font-variant-numeric: tabular-nums;
          font-size: var(--boxel-font-size-xs);
        }
        .sg-lbl {
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sg-dash {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sg-scope {
          grid-column: 1 / -1;
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export default Signatory;
