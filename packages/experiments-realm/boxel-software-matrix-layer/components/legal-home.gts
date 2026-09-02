import GlimmerComponent from '@glimmer/component';
import type Owner from '@ember/owner';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  identifyCard,
  type getCards,
} from '@cardstack/runtime-common';

import { StatePill } from './state-pill';
import { Contract } from '../contract';
import { CONTRACT_PIPELINE } from '../contract-status';

// Legal Home — the legal team's landing surface: the contract book by
// pipeline stage, plus the two lists a GC actually checks every morning —
// what is out for signature (waiting on someone else) and what expires
// soon (waiting on us). Live-queried; click any row to open the contract.

interface Signature {
  Args: {
    context?: any;
    realms?: string[];
    onOpen?: (contract: Contract) => void;
  };
  Element: HTMLElement;
}

const EXPIRY_WINDOW_DAYS = 60;

export class LegalHome extends GlimmerComponent<Signature> {
  private contractList: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.contractList = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Contract);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.args.realms,
      { isLive: true },
    );
  }

  get contracts(): Contract[] {
    return ((this.contractList?.instances ?? []) as Contract[]).filter(
      Boolean,
    );
  }

  get stages(): { stage: string; count: number }[] {
    return CONTRACT_PIPELINE.map((stage) => ({
      stage,
      count: this.contracts.filter((c) => c.status === stage).length,
    }));
  }

  get pendingSignature(): Contract[] {
    return this.contracts.filter((c) => c.status === 'out for signature');
  }

  get expiringSoon(): Contract[] {
    return this.contracts
      .filter(
        (c) =>
          c.status === 'signed' &&
          c.daysToExpiry != null &&
          c.daysToExpiry >= 0 &&
          c.daysToExpiry <= EXPIRY_WINDOW_DAYS,
      )
      .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));
  }

  open = (contract: Contract) => {
    this.args.onOpen?.(contract);
  };

  <template>
    <div class='home' ...attributes>
      <div class='stages'>
        {{#each this.stages as |s|}}
          <div class='stage'>
            <span class='stage-count'>{{s.count}}</span>
            <span class='stage-label'>{{s.stage}}</span>
          </div>
        {{/each}}
      </div>

      <div class='cols'>
        <section class='col'>
          <h3>Out for Signature ({{this.pendingSignature.length}})</h3>
          {{#each this.pendingSignature as |c|}}
            <button
              type='button'
              class='row-open'
              {{on 'click' (fn this.open c)}}
            >
              <span class='row-name'>{{c.title}}</span>
              <StatePill @label='pending' @hue='amber' @dot={{true}} />
            </button>
          {{else}}
            <p class='empty'>Nothing waiting on a counterparty.</p>
          {{/each}}
        </section>

        <section class='col'>
          <h3>Expiring Within {{EXPIRY_WINDOW_DAYS}} Days
            ({{this.expiringSoon.length}})</h3>
          {{#each this.expiringSoon as |c|}}
            <button
              type='button'
              class='row-open'
              {{on 'click' (fn this.open c)}}
            >
              <span class='row-name'>{{c.title}}</span>
              <span class='row-days'>{{c.daysToExpiry}}d</span>
            </button>
          {{else}}
            <p class='empty'>Nothing expiring in the window.</p>
          {{/each}}
        </section>
      </div>
    </div>
    <style scoped>
      .home {
        display: grid;
        gap: var(--boxel-sp);
        font-size: 0.875rem;
      }
      .stages {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .stage {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .stage-count {
        font-size: 1.375rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .stage-label {
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
      .row-open {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: 100%;
        text-align: left;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--radius, var(--boxel-border-radius));
        background: transparent;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-5xs);
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .row-open:hover {
        border-color: var(--primary, var(--boxel-highlight));
      }
      .row-name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-days {
        font-variant-numeric: tabular-nums;
        color: var(--state-amber-fg, #b45309);
        font-weight: 700;
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
