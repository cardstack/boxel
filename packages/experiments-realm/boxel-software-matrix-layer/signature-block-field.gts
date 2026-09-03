import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import enumField from '@cardstack/base/enum';
import SignatureIcon from '@cardstack/boxel-icons/signature';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { Signatory } from './signatory';
import { LegalPartyRoleField } from './legal-party-role-field';
import { StatePill } from './components/state-pill';
import { formatMoney } from './money';
import type { Hue } from './utils/index';

/**
 * Signature Block (SB) — one signature line on a document: who signs, for
 * which party, in what order, and what happened.
 *
 * WHY A FIELD AND NOT A CARD. A signature line has no life outside its
 * document — it is not searched for, linked to, or reused. It is part of the
 * document's own record, so it is a `containsMany` on the Contract (and on an
 * Amendment, an Addendum, an NDA), not a card that could drift away from it.
 *
 * WHY TWO WAYS TO NAME THE SIGNER. Our side signs through a `Signatory` card,
 * because that is where signing authority lives and authority is the thing
 * the ceremony checks. The counterparty's signer is a name and a title we are
 * told: we hold no authority record for them and it is not our job to — their
 * authority is their problem, ours is ours. So `signatory` is optional and
 * `signerName`/`signerTitle` carry the other side.
 *
 * `status` is the provider's word for the line. It never says "executed" —
 * execution is a property of the whole document and belongs to the Contract's
 * own status, written only by Execute Contract.
 */
export const SIGNATURE_BLOCK_STATUSES = [
  'pending',
  'requested',
  'signed',
  'declined',
];

export const SIGNATURE_BLOCK_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting turn',
  requested: 'Out for signature',
  signed: 'Signed',
  declined: 'Declined',
};

export const SIGNATURE_BLOCK_STATUS_HUE: Record<string, Hue> = {
  pending: 'slate',
  requested: 'amber',
  signed: 'green',
  declined: 'red',
};

export const SignatureBlockStatusField = enumField(StringField, {
  options: SIGNATURE_BLOCK_STATUSES.map((value) => ({
    value,
    label: SIGNATURE_BLOCK_STATUS_LABELS[value],
  })),
  displayName: 'Signature Block Status',
});

export function signatureBlockStatusLabel(value?: string | null): string {
  return SIGNATURE_BLOCK_STATUS_LABELS[value ?? ''] ?? 'Awaiting turn';
}

export class SignatureBlockField extends FieldDef {
  static displayName = 'Signature Block';
  static icon = SignatureIcon;

  /** Which side of the agreement this line binds. */
  @field party = contains(LegalPartyRoleField);
  /** Our signer, with the authority record the ceremony checks. */
  @field signatory = linksTo(() => Signatory);
  /** The counterparty's signer, as we were told. */
  @field signerName = contains(StringField);
  @field signerTitle = contains(StringField);
  /** 1-based. The ceremony proceeds strictly in this order. */
  @field signingOrder = contains(NumberField);
  /**
   * Named `lineStatus`, not `status`: a nested field called `status` inherits
   * the ROOT card's `status` configuration (field-component resolves
   * configuration against the owning card by field name), so a block's
   * dropdown would show the Contract's status options.
   */
  @field lineStatus = contains(SignatureBlockStatusField);
  @field requestedAt = contains(DateTimeField);
  @field signedAt = contains(DateTimeField);
  /** Provider envelope id, or a checksum of the signed copy. */
  @field signatureRef = contains(StringField);

  /** True when the line is ours — i.e. authority is checkable. */
  @field isInternal = contains(BooleanField, {
    computeVia: function (this: SignatureBlockField) {
      return Boolean(this.signatory);
    },
  });

  @field displayName = contains(StringField, {
    computeVia: function (this: SignatureBlockField) {
      // A query-loaded contract resolves the Signatory but not the Signatory's
      // own `person` link, so the title stands in for the name rather than
      // the line reading "Signer not named" beside a real signatory.
      let name = this.signatory?.person?.name?.trim();
      return (
        name ||
        this.signerName?.trim() ||
        this.signatory?.signingTitle?.trim() ||
        'Signer not named'
      );
    },
  });

  @field displayTitle = contains(StringField, {
    computeVia: function (this: SignatureBlockField) {
      let title = this.signatory?.signingTitle?.trim() || this.signerTitle?.trim() || '';
      // When the title is already standing in for the name, do not print it twice.
      let name = this.signatory?.person?.name?.trim() || this.signerName?.trim();
      return name ? title : '';
    },
  });

  @field entityName = contains(StringField, {
    computeVia: function (this: SignatureBlockField) {
      return this.party?.entity?.legalName?.trim() || '';
    },
  });

  static atom = class Atom extends Component<typeof this> {
    get hue(): Hue {
      return SIGNATURE_BLOCK_STATUS_HUE[this.args.model?.lineStatus ?? 'pending'] ?? 'slate';
    }
    <template>
      <span class='sb-atom'>
        <SignatureIcon class='sb-icon' role='presentation' />
        {{#if @model.signingOrder}}
          <span class='sb-order'>{{@model.signingOrder}}.</span>
        {{/if}}
        <span class='sb-name'>{{@model.displayName}}</span>
        <StatePill
          @label={{signatureBlockStatusLabel @model.lineStatus}}
          @hue={{this.hue}}
          @dot={{true}}
        />
      </span>
      <style scoped>
        .sb-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .sb-icon {
          width: 13px;
          height: 13px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sb-order {
          font-family: var(--font-mono, ui-monospace, monospace);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sb-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get hue(): Hue {
      return SIGNATURE_BLOCK_STATUS_HUE[this.args.model?.lineStatus ?? 'pending'] ?? 'slate';
    }
    // Tracked getters, not the computed fields: see SignatureBlockView.
    get signerName(): string {
      let m = this.args.model;
      let person: string | undefined;
      try {
        person = m?.signatory?.person?.name?.trim();
      } catch {
        person = undefined;
      }
      return person || m?.signerName?.trim() || m?.signatory?.signingTitle?.trim() || 'Signer not named';
    }
    get signerTitle(): string {
      let m = this.args.model;
      let person: string | undefined;
      try {
        person = m?.signatory?.person?.name?.trim();
      } catch {
        person = undefined;
      }
      if (!person && !m?.signerName?.trim()) return '';
      return m?.signatory?.signingTitle?.trim() || m?.signerTitle?.trim() || '';
    }
    get authorityLine(): string | undefined {
      let s = this.args.model?.signatory;
      if (!s) return undefined;
      let money = formatMoney(
        s.signatureAuthority?.amount,
        s.signatureAuthority?.currency?.code,
      );
      return money ? `authority ${money}` : 'no authority recorded';
    }
    get when(): string | undefined {
      let m = this.args.model;
      let d = m?.signedAt ?? m?.requestedAt;
      if (!d) return undefined;
      return new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
    <template>
      <div class='sb {{if (eqStatus @model.lineStatus "signed") "is-signed"}}'>
        <div class='sb-head'>
          {{#if @model.signingOrder}}
            <span class='sb-order'>{{@model.signingOrder}}</span>
          {{/if}}
          <span class='sb-party'>{{if
              @model.entityName
              @model.entityName
              'Party not set'
            }}
            {{#if @model.party.roleLabel}}<span class='sb-role'>({{@model.party.roleLabel}})</span>{{/if}}</span>
        </div>
        <p class='sb-signer'>
          <span class='sb-name'>{{this.signerName}}</span>{{~#if this.signerTitle}}<span class='sb-title'>, {{this.signerTitle}}</span>{{/if}}
        </p>
        <div class='sb-foot'>
          <StatePill
            @label={{signatureBlockStatusLabel @model.lineStatus}}
            @hue={{this.hue}}
            @dot={{true}}
          />
          {{#if this.when}}<span class='sb-when'>{{this.when}}</span>{{/if}}
          {{#if this.authorityLine}}<span class='sb-auth'>{{this.authorityLine}}</span>{{/if}}
        </div>
        {{#if @model.signatureRef}}
          <p class='sb-ref'>{{@model.signatureRef}}</p>
        {{/if}}
      </div>
      <style scoped>
        .sb {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          padding: 0.6rem 0.75rem;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm, 4px);
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-size: var(--boxel-font-size-sm);
          min-width: 0;
        }
        .sb.is-signed {
          border-color: color-mix(in oklch, var(--boxel-success) 45%, var(--border, var(--boxel-200)));
        }
        .sb-head {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sb-order {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
        }
        .sb-party {
          font-weight: 700;
        }
        .sb-role {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
        }
        .sb-signer {
          margin: 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.05rem;
          line-height: 1.3;
        }
        .sb-name {
          font-weight: 600;
        }
        .sb-title {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sb-foot {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.5rem;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sb-ref {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

function eqStatus(a?: string | null, b?: string) {
  return a === b;
}

/**
 * Edit — the signature page as a form: WHO FOR (party) on the first line,
 * WHO (our Signatory, or the counterparty's name and title) on the second,
 * the ceremony bookkeeping (order, status, dates, reference) compact at the
 * bottom because the commands normally write it.
 */
SignatureBlockField.edit = class Edit extends Component<typeof SignatureBlockField> {
  <template>
    <div class='sb-edit'>
      <FieldContainer @label='Party (entity + capacity)' @vertical={{true}}>
        <@fields.party />
      </FieldContainer>
      <div class='sb-who'>
        <FieldContainer @label='Our signatory (authority is checked)' @vertical={{true}}>
          <@fields.signatory />
        </FieldContainer>
        <div class='sb-ext'>
          <FieldContainer @label='Counterparty signer' @vertical={{true}}>
            <@fields.signerName />
          </FieldContainer>
          <FieldContainer @label='Their title' @vertical={{true}}>
            <@fields.signerTitle />
          </FieldContainer>
        </div>
      </div>
      <div class='sb-book'>
        <FieldContainer @label='Order' @vertical={{true}}>
          <@fields.signingOrder />
        </FieldContainer>
        <FieldContainer @label='Status' @vertical={{true}}>
          <@fields.lineStatus />
        </FieldContainer>
        <FieldContainer @label='Requested' @vertical={{true}}>
          <@fields.requestedAt />
        </FieldContainer>
        <FieldContainer @label='Signed' @vertical={{true}}>
          <@fields.signedAt />
        </FieldContainer>
      </div>
      <FieldContainer @label='Signature reference (envelope id or checksum)' @vertical={{true}}>
        <@fields.signatureRef />
      </FieldContainer>
      <p class='sb-hint'>Fill either our signatory or the counterparty's name —
        not both. Order, status and dates are normally written by Request
        Signature and the provider; edit only to correct.</p>
    </div>
    <style scoped>
      .sb-edit {
        container-type: inline-size;
        display: grid;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-left: 3px solid var(--foreground, var(--boxel-dark));
        border-radius: var(--boxel-border-radius-sm, 4px);
      }
      .sb-who {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-sm);
        align-items: start;
      }
      .sb-ext {
        display: grid;
        grid-template-columns: 3fr 2fr;
        gap: var(--boxel-sp-xs);
      }
      .sb-book {
        display: grid;
        grid-template-columns: 4rem 1fr 1fr 1fr;
        gap: var(--boxel-sp-xs);
        align-items: start;
      }
      .sb-hint {
        margin: 0;
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      @container (max-width: 560px) {
        .sb-who,
        .sb-ext,
        .sb-book {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
};

// ---------------------------------------------------------------------------
// The ceremony, as pure functions.
//
// Everything below is what Request Signature, Verify Signature and Execute
// Contract agree on. They live here, beside the field, so that the three
// commands and the Signature Block View can never disagree about what
// "in order" or "within authority" means — one definition, four readers.
// ---------------------------------------------------------------------------

export type FindingLevel = 'block' | 'warn';

export interface CeremonyFinding {
  /** 1-based signing order of the line the finding is about; 0 = whole ceremony. */
  order: number;
  signer: string;
  level: FindingLevel;
  message: string;
}

export type CeremonyState =
  | 'not started'
  | 'in progress'
  | 'complete'
  | 'declined';

export function sortedBlocks(
  blocks?: SignatureBlockField[] | null,
): SignatureBlockField[] {
  return (blocks ?? [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (a.signingOrder ?? 0) - (b.signingOrder ?? 0));
}

export function ceremonyState(
  blocks?: SignatureBlockField[] | null,
): CeremonyState {
  let list = sortedBlocks(blocks);
  if (!list.length) return 'not started';
  if (list.some((b) => b.lineStatus === 'declined')) return 'declined';
  if (list.every((b) => b.lineStatus === 'signed')) return 'complete';
  if (list.some((b) => b.lineStatus === 'signed' || b.lineStatus === 'requested'))
    return 'in progress';
  return 'not started';
}

/**
 * The line that may go out next: the lowest-order block still `pending`
 * whose every predecessor is `signed`. Undefined when nothing may go out —
 * either the ceremony is finished, or a predecessor has not signed yet.
 */
export function nextBlockToRequest(
  blocks?: SignatureBlockField[] | null,
): SignatureBlockField | undefined {
  let list = sortedBlocks(blocks);
  for (let b of list) {
    if (b.lineStatus === 'signed') continue;
    if (b.lineStatus === 'pending' || !b.lineStatus) return b;
    // requested or declined: the ceremony is waiting on this line.
    return undefined;
  }
  return undefined;
}

/**
 * Re-derive every check from the CURRENT data. Nothing is trusted from the
 * time the request went out: a signatory deactivated mid-ceremony fails here,
 * which is the whole reason Execute Contract runs this before it writes.
 */
export function verifyCeremony(
  blocks: SignatureBlockField[] | null | undefined,
  contractValue?: number | null,
  contractType?: string | null,
): CeremonyFinding[] {
  let list = sortedBlocks(blocks);
  let findings: CeremonyFinding[] = [];
  if (!list.length) {
    findings.push({
      order: 0,
      signer: '',
      level: 'block',
      message: 'No signature blocks — nobody is named to sign this document.',
    });
    return findings;
  }

  let seenOrders = new Set<number>();
  let lastSignedAt: number | undefined;
  let lastSignedOrder = 0;

  for (let b of list) {
    let order = b.signingOrder ?? 0;
    let signer = b.displayName ?? 'Signer not named';

    if (!order) {
      findings.push({
        order,
        signer,
        level: 'block',
        message: 'No signing order — the ceremony cannot tell who signs first.',
      });
    } else if (seenOrders.has(order)) {
      findings.push({
        order,
        signer,
        level: 'block',
        message: `Signing order ${order} is used twice.`,
      });
    }
    seenOrders.add(order);

    if (!b.party?.entity) {
      findings.push({
        order,
        signer,
        level: 'block',
        message: 'No legal entity behind this line — a signature binds a party, not a person.',
      });
    }

    if (b.signatory) {
      let verdict = b.signatory.canSign(contractValue, contractType);
      if (!verdict.allowed) {
        findings.push({ order, signer, level: 'block', message: verdict.reason });
      }
    } else if (!b.signerName?.trim()) {
      findings.push({
        order,
        signer,
        level: 'block',
        message: 'Counterparty signer is not named.',
      });
    }

    if (b.lineStatus === 'declined') {
      findings.push({
        order,
        signer,
        level: 'block',
        message: 'Declined to sign.',
      });
    }

    if (b.lineStatus === 'signed') {
      if (!b.signatureRef?.trim()) {
        findings.push({
          order,
          signer,
          level: 'block',
          message: 'Marked signed but carries no signature reference — nothing proves it.',
        });
      }
      let t = b.signedAt ? new Date(b.signedAt).getTime() : NaN;
      if (Number.isFinite(t) && lastSignedAt !== undefined && t < lastSignedAt) {
        findings.push({
          order,
          signer,
          level: 'block',
          message: `Signed before line ${lastSignedOrder} — out of signing order.`,
        });
      }
      if (Number.isFinite(t)) {
        lastSignedAt = t;
        lastSignedOrder = order;
      }
    } else if (
      list.some(
        (later) =>
          (later.signingOrder ?? 0) > order && later.lineStatus === 'signed',
      )
    ) {
      findings.push({
        order,
        signer,
        level: 'block',
        message: 'A later line signed while this one is still open — out of signing order.',
      });
    }
  }

  return findings;
}

export function ceremonyIsClean(findings: CeremonyFinding[]): boolean {
  return !findings.some((f) => f.level === 'block');
}

export default SignatureBlockField;
