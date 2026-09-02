import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

import { StatePill } from './state-pill';
import type { ContractClause } from '../contract-clause';
import {
  CLAUSE_TYPE_LABELS,
} from '../clause';
import { DEVIATION_SEVERITY_HUE } from '../contract-clause';
import type { Hue } from '../utils/index';

// Clause Navigator — the table of contents a reviewer actually needs: a
// contract's clauses grouped by type, each row carrying its deviation
// severity so the eye lands on what moved away from standard language
// first. Render-only: the consumer (contract workspace or contract page)
// supplies resolved ContractClause instances and the open callback.

interface Group {
  type: string;
  label: string;
  clauses: ContractClause[];
}

interface Signature {
  Args: {
    clauses: ContractClause[] | undefined;
    onOpen?: (clause: ContractClause) => void;
  };
  Element: HTMLElement;
}

export class ClauseNavigator extends GlimmerComponent<Signature> {
  get clauses(): ContractClause[] {
    return (this.args.clauses ?? []).filter(Boolean);
  }

  get groups(): Group[] {
    let byType = new Map<string, ContractClause[]>();
    for (let clause of this.clauses) {
      let type = clause.clauseType ?? 'other';
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(clause);
    }
    return [...byType.entries()].map(([type, clauses]) => ({
      type,
      label: CLAUSE_TYPE_LABELS[type] ?? type,
      clauses,
    }));
  }

  get deviationCount(): number {
    return this.clauses.filter(
      (c) => c.deviationSeverity && c.deviationSeverity !== 'none',
    ).length;
  }

  hueFor = (clause: ContractClause): Hue =>
    (DEVIATION_SEVERITY_HUE[clause.deviationSeverity ?? 'none'] ??
      'slate') as Hue;

  open = (clause: ContractClause) => {
    this.args.onOpen?.(clause);
  };

  <template>
    <nav class='navigator' aria-label='Contract clauses' ...attributes>
      {{#if this.clauses.length}}
        <p class='summary'>{{this.clauses.length}} clauses ·
          {{this.deviationCount}} deviate from standard</p>
        {{#each this.groups as |group|}}
          <section class='group'>
            <h3>{{group.label}}</h3>
            <ul>
              {{#each group.clauses as |clause|}}
                <li>
                  <button
                    type='button'
                    class='clause-row'
                    {{on 'click' (fn this.open clause)}}
                  >
                    <span class='clause-name'>{{clause.cardTitle}}</span>
                    <StatePill
                      @label={{clause.deviationSeverity}}
                      @hue={{this.hueFor clause}}
                      @dot={{true}}
                    />
                  </button>
                </li>
              {{/each}}
            </ul>
          </section>
        {{/each}}
      {{else}}
        <p class='empty'>No clauses recorded for this contract yet.</p>
      {{/if}}
    </nav>
    <style scoped>
      .navigator {
        display: grid;
        gap: var(--boxel-sp-sm);
        font-size: 0.875rem;
      }
      .summary {
        margin: 0;
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.8125rem;
        font-variant-numeric: tabular-nums;
      }
      .group h3 {
        margin: 0 0 var(--boxel-sp-5xs);
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }
      .clause-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: 100%;
        text-align: left;
        border: none;
        border-radius: calc(var(--radius, var(--boxel-border-radius)) / 1.5);
        background: transparent;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .clause-row:hover {
        background: var(--muted, var(--boxel-100));
      }
      .clause-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        margin: 0;
        color: var(--muted-foreground, var(--boxel-450));
        font-style: italic;
      }
    </style>
  </template>
}
