import GlimmerComponent from '@glimmer/component';
import type Owner from '@ember/owner';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';

import { StatePill } from './state-pill';
import { formatMoney } from '../money';
import type { Vendor } from '../vendor';
import { VendorQuote } from '../vendor-quote';
import { PurchaseOrder, PO_STATUS_LABELS } from '../purchase-order';
import { VendorProfile } from '../vendor-profile';

// Vendor Workspace — the buyer's 360° dossier ON one vendor (single-persona
// reinterpretation of the tracked concept: this is NOT a vendor-facing
// portal). Aggregates live realm data — the vendor's profile/compliance,
// their quotes, their POs and receipt states, win rate, and spend — via
// live queries rather than hand-maintained link arrays, so the dossier
// stays current as quotes and POs are created elsewhere.

interface Signature {
  Args: {
    vendor: Vendor | undefined;
    context?: any;
  };
  Element: HTMLElement;
}

export class VendorWorkspace extends GlimmerComponent<Signature> {
  private quoteList: ReturnType<getCards> | undefined;
  private poList: ReturnType<getCards> | undefined;
  private profileList: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.quoteList = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(VendorQuote);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realms,
      { isLive: true },
    );
    this.poList = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(PurchaseOrder);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realms,
      { isLive: true },
    );
    this.profileList = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(VendorProfile);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realms,
      { isLive: true },
    );
  }

  private get realms(): string[] | undefined {
    let url = (this.args.vendor as any)?.[realmURL];
    return url ? [url.href] : undefined;
  }

  private get vendorId(): string | undefined {
    return this.args.vendor?.id;
  }

  get quotes(): VendorQuote[] {
    let id = this.vendorId;
    if (!id) {
      return [];
    }
    return ((this.quoteList?.instances ?? []) as VendorQuote[]).filter((q) => {
      try {
        return q.vendor?.id === id;
      } catch {
        return false;
      }
    });
  }

  get pos(): PurchaseOrder[] {
    let id = this.vendorId;
    if (!id) {
      return [];
    }
    return ((this.poList?.instances ?? []) as PurchaseOrder[]).filter((po) => {
      try {
        return po.vendor?.id === id;
      } catch {
        return false;
      }
    });
  }

  get profile(): VendorProfile | undefined {
    let id = this.vendorId;
    if (!id) {
      return undefined;
    }
    return ((this.profileList?.instances ?? []) as VendorProfile[]).find(
      (p) => {
        try {
          return p.linkedVendor?.id === id;
        } catch {
          return false;
        }
      },
    );
  }

  get complianceKnown(): boolean {
    return Boolean(this.profile);
  }

  get complianceOk(): boolean {
    return Boolean(this.profile?.complianceOk);
  }

  get winRate(): string {
    let quotes = this.quotes.length;
    if (!quotes) {
      return '—';
    }
    let wins = this.pos.length;
    return `${Math.round((Math.min(wins, quotes) / quotes) * 100)}%`;
  }

  get spend(): string {
    let total = this.pos
      .filter((po) =>
        ['approved', 'sent', 'partially-received', 'received', 'closed'].includes(
          po.status ?? '',
        ),
      )
      .reduce((sum, po) => sum + (po.totalAmount ?? 0), 0);
    return formatMoney(total, 'USD');
  }

  poStatusLabel = (po: PurchaseOrder) =>
    PO_STATUS_LABELS[po.status ?? ''] ?? 'Draft';

  poTotalLabel = (po: PurchaseOrder) => formatMoney(po.totalAmount ?? 0, 'USD');

  quoteTotalLabel = (q: VendorQuote) => formatMoney(q.totalAmount ?? 0, 'USD');

  <template>
    <div class='workspace' ...attributes>
      <div class='stats'>
        <div class='stat'>
          <span class='stat-value'>{{this.quotes.length}}</span>
          <span class='stat-label'>quotes recorded</span>
        </div>
        <div class='stat'>
          <span class='stat-value'>{{this.winRate}}</span>
          <span class='stat-label'>win rate</span>
        </div>
        <div class='stat'>
          <span class='stat-value'>{{this.spend}}</span>
          <span class='stat-label'>committed + spent</span>
        </div>
        <div class='stat'>
          {{#if this.complianceKnown}}
            <StatePill
              @label={{if this.complianceOk 'current' 'lapsed'}}
              @hue={{if this.complianceOk 'green' 'red'}}
              @dot={{true}}
            />
          {{else}}
            <StatePill @label='no profile' @hue='slate' @chrome={{true}} />
          {{/if}}
          <span class='stat-label'>compliance</span>
        </div>
      </div>

      <div class='cols'>
        <section class='col'>
          <h3>Purchase Orders</h3>
          {{#each this.pos as |po|}}
            <div class='mini-row'>
              <span class='mini-name'>{{po.poNumber}}</span>
              <span class='mini-num'>{{this.poTotalLabel po}}</span>
              <span class='mini-status'>{{this.poStatusLabel po}}</span>
            </div>
          {{else}}
            <p class='empty'>No POs yet.</p>
          {{/each}}
        </section>
        <section class='col'>
          <h3>Quotes</h3>
          {{#each this.quotes as |q|}}
            <div class='mini-row'>
              <span class='mini-name'>{{q.title}}</span>
              <span class='mini-num'>{{this.quoteTotalLabel q}}</span>
            </div>
          {{else}}
            <p class='empty'>No quotes recorded.</p>
          {{/each}}
        </section>
      </div>
    </div>
    <style scoped>
      .workspace {
        display: grid;
        gap: var(--boxel-sp);
        font-size: 0.875rem;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .stat {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        align-items: flex-start;
      }
      .stat-value {
        font-size: 1.25rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .stat-label {
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .cols {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .col {
        min-width: 0;
      }
      h3 {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: 0.8125rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .mini-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: var(--boxel-sp-xs);
        align-items: baseline;
        padding: var(--boxel-sp-4xs) 0;
        border-bottom: 1px solid var(--border, var(--boxel-100));
      }
      .mini-name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 0.8125rem;
      }
      .mini-num {
        font-variant-numeric: tabular-nums;
      }
      .mini-status {
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .empty {
        margin: 0;
        color: var(--muted-foreground, var(--boxel-450));
        font-style: italic;
      }
      @container (max-width: 560px) {
        .cols {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}
