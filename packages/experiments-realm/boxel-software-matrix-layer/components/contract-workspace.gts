import GlimmerComponent from '@glimmer/component';
import type Owner from '@ember/owner';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';

import { StatePill } from './state-pill';
import { ClauseNavigator } from './clause-navigator';
import type { Contract } from '../contract';
import { ContractClause } from '../contract-clause';
import { ContractVersion } from '../contract-version';
import { Amendment } from '../amendment';
import { Addendum } from '../addendum';
import { Waiver } from '../waiver';

// Contract Workspace — everything hanging off ONE contract on one surface:
// its clause navigator, executed version history, and the modification
// papers (amendments, addenda, waivers) that trail a living agreement.
// Live-queried rather than link-array-maintained, so paper created anywhere
// in the realm shows up here without anyone remembering to wire it.

interface Signature {
  Args: {
    contract: Contract | undefined;
    context?: any;
    onOpen?: (card: any) => void;
  };
  Element: HTMLElement;
}

export class ContractWorkspace extends GlimmerComponent<Signature> {
  private clauseList: ReturnType<getCards> | undefined;
  private versionList: ReturnType<getCards> | undefined;
  private amendmentList: ReturnType<getCards> | undefined;
  private addendumList: ReturnType<getCards> | undefined;
  private waiverList: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let realms = () => this.realms;
    let live = { isLive: true };
    let queryFor = (type: any) => () => {
      let ref = identifyCard(type);
      return ref ? { filter: { type: ref } } : undefined;
    };
    let ctx = this.args.context;
    this.clauseList = ctx?.getCards(this, queryFor(ContractClause), realms, live);
    this.versionList = ctx?.getCards(this, queryFor(ContractVersion), realms, live);
    this.amendmentList = ctx?.getCards(this, queryFor(Amendment), realms, live);
    this.addendumList = ctx?.getCards(this, queryFor(Addendum), realms, live);
    this.waiverList = ctx?.getCards(this, queryFor(Waiver), realms, live);
  }

  private get realms(): string[] | undefined {
    let url = (this.args.contract as any)?.[realmURL];
    return url ? [url.href] : undefined;
  }

  private belongsToContract = (item: any): boolean => {
    let id = this.args.contract?.id;
    if (!id) {
      return false;
    }
    try {
      return item?.contract?.id === id;
    } catch {
      return false;
    }
  };

  get clauses(): ContractClause[] {
    return ((this.clauseList?.instances ?? []) as ContractClause[]).filter(
      this.belongsToContract,
    );
  }
  get versions(): ContractVersion[] {
    return ((this.versionList?.instances ?? []) as ContractVersion[])
      .filter(this.belongsToContract)
      .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0));
  }
  get amendments(): Amendment[] {
    return ((this.amendmentList?.instances ?? []) as Amendment[]).filter(
      this.belongsToContract,
    );
  }
  get addenda(): Addendum[] {
    return ((this.addendumList?.instances ?? []) as Addendum[]).filter(
      this.belongsToContract,
    );
  }
  get waivers(): Waiver[] {
    return ((this.waiverList?.instances ?? []) as Waiver[]).filter(
      this.belongsToContract,
    );
  }

  get signatureLabel(): string {
    switch (this.args.contract?.signatureStatus) {
      case 'signed':
        return 'signed';
      case 'pending':
        return 'out for signature';
      case 'declined':
        return 'declined';
      case 'voided':
        return 'voided';
      default:
        return 'not sent';
    }
  }

  get signatureHue(): 'green' | 'amber' | 'red' | 'slate' {
    switch (this.args.contract?.signatureStatus) {
      case 'signed':
        return 'green';
      case 'pending':
        return 'amber';
      case 'declined':
      case 'voided':
        return 'red';
      default:
        return 'slate';
    }
  }

  open = (card: any) => {
    this.args.onOpen?.(card);
  };

  get hasModifications() {
    return (
      this.amendments.length + this.addenda.length + this.waivers.length > 0
    );
  }

  <template>
    <div class='workspace' ...attributes>
      <div class='strip'>
        <StatePill @label={{@contract.status}} @hue='blue' @emphatic={{true}} />
        <StatePill
          @label='signature: {{this.signatureLabel}}'
          @hue={{this.signatureHue}}
          @dot={{true}}
        />
        <span class='counts'>{{this.versions.length}} versions ·
          {{this.amendments.length}} amendments · {{this.addenda.length}}
          addenda · {{this.waivers.length}} waivers</span>
      </div>

      <div class='cols'>
        <section class='col'>
          <h3>Clauses</h3>
          <ClauseNavigator @clauses={{this.clauses}} @onOpen={{this.open}} />
        </section>

        <section class='col'>
          <h3>Version History</h3>
          {{#each this.versions as |v|}}
            <div class='mini-row'>
              <span class='mini-name'>v{{v.versionNumber}}</span>
              <span class='mini-meta'>{{v.summary}}</span>
            </div>
          {{else}}
            <p class='empty'>Not executed yet — no versions.</p>
          {{/each}}

          <h3 class='mt'>Modifications</h3>
          {{#each this.amendments as |a|}}
            <div class='mini-row'>
              <span class='mini-name'>{{a.cardTitle}}</span>
              <span class='mini-meta'>{{a.status}}</span>
            </div>
          {{/each}}
          {{#each this.addenda as |a|}}
            <div class='mini-row'>
              <span class='mini-name'>{{a.cardTitle}}</span>
              <span class='mini-meta'>{{a.status}}</span>
            </div>
          {{/each}}
          {{#each this.waivers as |w|}}
            <div class='mini-row'>
              <span class='mini-name'>{{w.cardTitle}}</span>
              <span class='mini-meta'>{{w.scope}}</span>
            </div>
          {{/each}}
          {{#unless this.hasModifications}}
            <p class='empty'>No amendments, addenda, or waivers.</p>
          {{/unless}}
        </section>
      </div>
    </div>
    <style scoped>
      .workspace {
        display: grid;
        gap: var(--boxel-sp);
        font-size: 0.875rem;
      }
      .strip {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .counts {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.8125rem;
        font-variant-numeric: tabular-nums;
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
      h3.mt {
        margin-top: var(--boxel-sp);
      }
      .mini-row {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--boxel-sp-xs);
        align-items: baseline;
        padding: var(--boxel-sp-4xs) 0;
        border-bottom: 1px solid var(--border, var(--boxel-100));
      }
      .mini-name {
        font-weight: 600;
        white-space: nowrap;
      }
      .mini-meta {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.8125rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
