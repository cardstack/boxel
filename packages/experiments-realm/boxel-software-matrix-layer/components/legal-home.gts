import GlimmerComponent from '@glimmer/component';
import type Owner from '@ember/owner';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import {
  identifyCard,
  type getCards,
} from '@cardstack/runtime-common';

import { StatePill } from './state-pill';
import { Contract } from '../contract';
import {
  ContractClause,
  DEVIATION_SEVERITY_HUE,
  deviationLabel,
} from '../contract-clause';
import { CONTRACT_PIPELINE, contractStatusLabel } from '../contract-status';
import { formatMoney } from '../money';
import { formatDay } from '../effective-period-field';

// Legal Home — the desk's landing surface.
//
//   HERO          the one number the desk is judged on: value in force — with
//                 executed count, deadlines inside 90 days and open deviations
//                 as stat tiles beside it.
//   PIPELINE      the contract book as a rail: one node per lifecycle stage.
//   RUNWAY        the twelve months ahead as a timeline. Every in-force
//                 contract is a row: a thin bar runs from today to its NOTICE
//                 deadline (the last day to stop a renewal), a hollow mark
//                 sits at the end date. The bar is the time left to act; when
//                 it has run out the mark sits at the left edge, in red.
//   LISTS         awaiting signature (waiting on someone else) and open
//                 deviations (waiting on us).
//
// Live-queried; every row opens its contract through `@onOpen`. Chart rules
// follow the dataviz skill: one hue for magnitude, status hues only for state,
// thin marks with surface gaps, text in text tokens, labels placed selectively.

interface Signature {
  Args: {
    context?: any;
    realms?: string[];
    onOpen?: (contract: Contract) => void;
    /**
     * The desk's own thresholds — the block has no opinion on them
     * (block-factory: the consumer declares the domain specifics).
     */
    /** Days-to-notice inside which a deadline is live work. Default 90. */
    noticeWindowDays?: number;
    /** How far ahead the runway looks. Default 365. */
    runwayDays?: number;
    /** For contracts with no notice terms: plain expiry inside this. Default 60. */
    expiryWindowDays?: number;
  };
  Element: HTMLElement;
}

const DEFAULT_NOTICE_WINDOW_DAYS = 90;
const DEFAULT_RUNWAY_DAYS = 365;
const DEFAULT_EXPIRY_WINDOW_DAYS = 60;

const SEVERITY_RANK: Record<string, number> = {
  bespoke: 0,
  major: 1,
  minor: 2,
  none: 3,
};

type Urgency = 'late' | 'urgent' | 'soon' | 'clear';

interface RunwayRow {
  contract: Contract;
  title: string;
  value: string;
  /** Days to the notice deadline (or to expiry when no notice terms). */
  days: number;
  kind: 'notice' | 'expiry';
  urgency: Urgency;
  /** Percent positions along the 12-month axis, clamped to [0, 100]. */
  noticeX: number;
  endX: number | undefined;
  when: string;
  endLabel: string;
  daysLabel: string;
  tooltip: string;
}

function urgencyOf(days: number, noticeWindow: number): Urgency {
  if (days < 0) return 'late';
  if (days <= 30) return 'urgent';
  if (days <= noticeWindow) return 'soon';
  return 'clear';
}

export class LegalHome extends GlimmerComponent<Signature> {
  private contractList: ReturnType<getCards> | undefined;
  private clauseList: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let ctx = this.args.context;
    this.contractList = ctx?.getCards(
      this,
      () => {
        let ref = identifyCard(Contract);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.args.realms,
      { isLive: true },
    );
    this.clauseList = ctx?.getCards(
      this,
      () => {
        let ref = identifyCard(ContractClause);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.args.realms,
      { isLive: true },
    );
  }

  get noticeWindow(): number {
    return this.args.noticeWindowDays ?? DEFAULT_NOTICE_WINDOW_DAYS;
  }
  get runwayDays(): number {
    return this.args.runwayDays ?? DEFAULT_RUNWAY_DAYS;
  }
  get expiryWindow(): number {
    return this.args.expiryWindowDays ?? DEFAULT_EXPIRY_WINDOW_DAYS;
  }

  get contracts(): Contract[] {
    return ((this.contractList?.instances ?? []) as Contract[]).filter(
      Boolean,
    );
  }

  get clauses(): ContractClause[] {
    return ((this.clauseList?.instances ?? []) as ContractClause[]).filter(
      Boolean,
    );
  }

  get inForce(): Contract[] {
    return this.contracts.filter((c) => c.status === 'signed');
  }

  // ---- pipeline ------------------------------------------------------------

  get stages(): { stage: string; label: string; count: number; last: boolean }[] {
    return CONTRACT_PIPELINE.map((stage, i) => ({
      stage,
      label: contractStatusLabel(stage),
      count: this.contracts.filter((c) => c.status === stage).length,
      last: i === CONTRACT_PIPELINE.length - 1,
    }));
  }

  // ---- hero + stat tiles ---------------------------------------------------

  get executedCount(): number {
    return this.inForce.length;
  }

  /** In-force value, summed per currency; the hero shows the largest bucket. */
  get activeValue(): { hero: string; rest: string[] } {
    let byCurrency = new Map<string, number>();
    for (let c of this.inForce) {
      let amt = c.value?.amount;
      if (typeof amt !== 'number' || !Number.isFinite(amt)) continue;
      let code = c.value?.currency?.code ?? 'USD';
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + amt);
    }
    let entries = [...byCurrency.entries()].sort((a, b) => b[1] - a[1]);
    let labels = entries
      .map(([code, amt]) => formatMoney(amt, code))
      .filter(Boolean) as string[];
    return { hero: labels[0] ?? '—', rest: labels.slice(1) };
  }

  get runway(): RunwayRow[] {
    let rows: RunwayRow[] = [];
    for (let c of this.inForce) {
      let notice = c.daysToNotice;
      let expiry = c.daysToExpiry;
      let hasNotice = typeof notice === 'number' && Number.isFinite(notice);
      let hasExpiry = typeof expiry === 'number' && Number.isFinite(expiry);
      if (!hasNotice && !hasExpiry) continue;
      let days = hasNotice ? (notice as number) : (expiry as number);
      // Off the runway entirely: an end date more than a year out with a
      // notice deadline also beyond it has nothing to say this year.
      if (days > this.runwayDays) continue;
      if (!hasNotice && days < 0) continue; // already expired without terms
      let pct = (d: number) => Math.max(0, Math.min(100, (d / this.runwayDays) * 100));
      rows.push({
        contract: c,
        title: c.title ?? c.cardTitle ?? 'Contract',
        value: formatMoney(c.value?.amount, c.value?.currency?.code) ?? '',
        days,
        kind: hasNotice ? 'notice' : 'expiry',
        urgency: hasNotice ? urgencyOf(days, this.noticeWindow) : days <= this.expiryWindow ? 'soon' : 'clear',
        noticeX: pct(days),
        endX: hasExpiry && (expiry as number) <= this.runwayDays ? pct(expiry as number) : undefined,
        when: hasNotice ? (c.noticeBy ?? '') : formatDay(c.endDate),
        endLabel: hasExpiry ? formatDay(c.endDate) : '',
        daysLabel:
          days < 0
            ? `${Math.abs(days)}d late`
            : `${days}d ${hasNotice ? 'to give notice' : 'to expiry'}`,
        tooltip: '',
      });
      let r = rows[rows.length - 1];
      r.tooltip =
        `${r.title} — ${r.daysLabel}` +
        (r.when ? ` (${r.when})` : '') +
        (r.endLabel ? `; term ends ${r.endLabel}` : '');
    }
    return rows.sort((a, b) => a.days - b.days);
  }

  /** Real notice deadlines (contracts WITH notice terms) inside the window. */
  get deadlinesInWindow(): RunwayRow[] {
    return this.runway.filter(
      (r) => r.kind === 'notice' && r.days <= this.noticeWindow,
    );
  }

  get worstDeadline(): RunwayRow | undefined {
    return this.runway.find((r) => r.kind === 'notice');
  }

  /** Month ticks along the runway: 12 hairlines, a label every quarter. */
  get months(): { x: number; label: string }[] {
    let out: { x: number; label: string }[] = [];
    let today = new Date();
    for (let i = 1; i <= 12; i++) {
      let d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      let days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      out.push({
        x: Math.min(100, (days / this.runwayDays) * 100),
        label: i % 3 === 0 ? d.toLocaleDateString('en-GB', { month: 'short' }) : '',
      });
    }
    return out;
  }

  get pendingSignature(): Contract[] {
    return this.contracts.filter((c) => c.status === 'out for signature');
  }

  /** Off-playbook clauses on contracts still in play, most severe first. */
  get openDeviations(): ContractClause[] {
    return this.clauses
      .filter((cl) => {
        if (!cl.isDeviation) return false;
        let s = cl.contract?.status;
        return s !== 'terminated' && s !== 'expired';
      })
      .sort(
        (a, b) =>
          (SEVERITY_RANK[a.deviationSeverity ?? 'none'] ?? 9) -
          (SEVERITY_RANK[b.deviationSeverity ?? 'none'] ?? 9),
      );
  }

  get highestSeverity(): string | undefined {
    return this.openDeviations[0]?.deviationSeverity ?? undefined;
  }

  severityHue = (value?: string | null) =>
    DEVIATION_SEVERITY_HUE[value ?? ''] ?? 'slate';
  severityLabel = (value?: string | null) => deviationLabel(value);

  open = (contract: Contract | undefined) => {
    if (contract) this.args.onOpen?.(contract);
  };

  openClauseContract = (clause: ContractClause) => {
    this.open(clause.contract);
  };

  <template>
    <div class='home' ...attributes>
      {{! ---- 1. Where we stand: one hero figure, three tiles ---- }}
      <section class='band' aria-label='Where we stand'>
        <div class='sec-head'>
          <h3>Where we stand</h3>
          <p class='sec-note'>Value in force today, and the three counts the desk is judged on.</p>
        </div>
        <div class='hero'>
          <div class='hero-fig'>
            <span class='hero-label'>Value in force</span>
            <span class='hero-value'>{{this.activeValue.hero}}</span>
            {{#if this.activeValue.rest.length}}
              <span class='hero-sub'>+ {{join this.activeValue.rest}}</span>
            {{else}}
              <span class='hero-sub'>across {{this.executedCount}} executed {{if (eq this.executedCount 1) 'agreement' 'agreements'}}</span>
            {{/if}}
          </div>
          <div class='tiles'>
            <div class='tile'>
              <span class='tile-label'>Executed</span>
              <span class='tile-value'>{{this.executedCount}}</span>
              <span class='tile-sub'>signed and in force</span>
            </div>
            <div class='tile {{if this.worstDeadline (concat "u-" this.worstDeadline.urgency)}}'>
              <span class='tile-label'>Notice deadlines</span>
              <span class='tile-value'>{{this.deadlinesInWindow.length}}</span>
              <span class='tile-sub'>{{#if this.worstDeadline}}nearest {{this.worstDeadline.daysLabel}}{{else}}none inside {{this.noticeWindow}} days{{/if}}</span>
            </div>
            <div class='tile'>
              <span class='tile-label'>Open deviations</span>
              <span class='tile-value'>{{this.openDeviations.length}}</span>
              <span class='tile-sub'>{{#if this.highestSeverity}}worst is {{this.severityLabel this.highestSeverity}}{{else}}every clause on playbook{{/if}}</span>
            </div>
          </div>
        </div>
      </section>

      <div class='main'>
        <div class='left'>
          {{! ---- 2. The year ahead ---- }}
          <section class='band' aria-label='Renewal runway, next twelve months'>
            <div class='sec-head'>
              <h3>The year ahead</h3>
              <p class='sec-note'>Each in-force contract, and how long is left to stop its renewal. The bar is the time you still have; the dot is the notice deadline; the ring is the end of term.</p>
            </div>
            {{#if this.runway.length}}
              <div class='rw-grid'>
                <div class='rw-axis' aria-hidden='true'>
                  <span class='rw-today'>today</span>
                  {{#each this.months as |m|}}
                    <span class='rw-tick {{if m.label "labelled"}}' style={{leftPct m.x}}>{{m.label}}</span>
                  {{/each}}
                </div>
                {{#each this.runway as |row|}}
                  <button
                    type='button'
                    class='rw-row u-{{row.urgency}} k-{{row.kind}}'
                    title={{row.tooltip}}
                    {{on 'click' (fn this.open row.contract)}}
                  >
                    <span class='rw-title'>{{row.title}}</span>
                    <span class='rw-plot' aria-hidden='true'>
                      {{#each this.months as |m|}}
                        <span class='rw-grid-line' style={{leftPct m.x}}></span>
                      {{/each}}
                      <span class='rw-bar' style={{widthPct row.noticeX}}></span>
                      {{#if row.endX}}
                        <span class='rw-end' style={{leftPct row.endX}}></span>
                      {{/if}}
                      <span class='rw-mark' style={{leftPct row.noticeX}}></span>
                    </span>
                    <span class='rw-days'>{{row.daysLabel}}</span>
                    <span class='rw-value'>{{row.value}}</span>
                  </button>
                {{/each}}
              </div>
              <p class='rw-key' aria-hidden='true'>
                <span class='key-bar'></span> time left to give notice
                <span class='key-dot'></span> notice deadline
                <span class='key-ring'></span> end of term
              </p>
            {{else}}
              <p class='empty'>No in-force contract ends inside the next twelve months.</p>
            {{/if}}
          </section>

          {{! ---- 3. Where every contract sits ---- }}
          <section class='band' aria-label='Contracts by lifecycle stage'>
            <div class='sec-head'>
              <h3>Where every contract sits</h3>
              <p class='sec-note'>The book by lifecycle stage, left to right from first draft to in force.</p>
            </div>
            <div class='rail'>
              {{#each this.stages as |s|}}
                <div class='stage {{if s.count "has"}}'>
                  <span class='node'>{{s.count}}</span>
                  {{#unless s.last}}<span class='track' aria-hidden='true'></span>{{/unless}}
                  <span class='stage-label'>{{s.label}}</span>
                </div>
              {{/each}}
            </div>
          </section>
        </div>

        {{! ---- 4. Needs attention ---- }}
        <aside class='right' aria-label='Needs attention'>
          <div class='sec-head'>
            <h3>Needs attention</h3>
            <p class='sec-note'>Three queues, most urgent first. Every row opens its contract.</p>
          </div>

          <section class='queue' aria-label='Notice deadlines'>
            <h4>Notice deadlines <span class='h-n'>{{this.deadlinesInWindow.length}}</span></h4>
            {{#each this.deadlinesInWindow as |row|}}
              <button
                type='button'
                class='row-open u-{{row.urgency}}'
                title={{row.tooltip}}
                {{on 'click' (fn this.open row.contract)}}
              >
                <span class='row-main'>
                  <span class='row-name'>{{row.title}}</span>
                  <span class='row-sub'>notice by {{row.when}}</span>
                </span>
                <span class='row-days'>{{row.daysLabel}}</span>
              </button>
            {{else}}
              <p class='empty'>No notice deadline inside {{this.noticeWindow}} days.</p>
            {{/each}}
          </section>

          <section class='queue' aria-label='Awaiting signature'>
            <h4>Awaiting signature <span class='h-n'>{{this.pendingSignature.length}}</span></h4>
            {{#each this.pendingSignature as |c|}}
              <button
                type='button'
                class='row-open'
                {{on 'click' (fn this.open c)}}
              >
                <span class='row-main'>
                  <span class='row-name'>{{c.title}}</span>
                  {{#if c.signatureRequestedAt}}
                    <span class='row-sub'>sent {{formatDay c.signatureRequestedAt}}
                      {{#if c.signatureProvider}}· {{c.signatureProvider}}{{/if}}</span>
                  {{/if}}
                </span>
                <StatePill @label='pending' @hue='amber' @dot={{true}} />
              </button>
            {{else}}
              <p class='empty'>Nothing waiting on a counterparty.</p>
            {{/each}}
          </section>

          <section class='queue' aria-label='Open deviations'>
            <h4>Open deviations <span class='h-n'>{{this.openDeviations.length}}</span></h4>
            {{#each this.openDeviations as |cl|}}
              <button
                type='button'
                class='row-open'
                {{on 'click' (fn this.openClauseContract cl)}}
              >
                <span class='row-main'>
                  <span class='row-name'>{{cl.cardTitle}}</span>
                  {{#if cl.contract}}
                    <span class='row-sub'>{{cl.contract.title}}</span>
                  {{/if}}
                </span>
                <StatePill
                  @label={{this.severityLabel cl.deviationSeverity}}
                  @hue={{this.severityHue cl.deviationSeverity}}
                  @dot={{true}}
                />
              </button>
            {{else}}
              <p class='empty'>Every clause in play is on playbook.</p>
            {{/each}}
          </section>
        </aside>
      </div>
    </div>
    <style scoped>
      .home {
        /* adapter block (boxel-theming §1a): the card namespace forwards the
           semantic set once; status hues are data, mixed toward the card's own
           ink so the pair survives a linked theme (§2). No literal colours. */
        --lh-ink: var(--foreground, var(--boxel-dark));
        --lh-muted: var(--muted-foreground, var(--boxel-450));
        --lh-surface: var(--card, var(--background, var(--boxel-light)));
        --lh-line: var(--border, var(--boxel-200));
        --lh-band: color-mix(in oklch, var(--lh-ink) 3%, transparent);
        --lh-warn: color-mix(in oklch, var(--boxel-warning) 65%, var(--lh-ink));
        --lh-late: color-mix(in oklch, var(--boxel-danger) 70%, var(--lh-ink));
        --lh-late-bg: color-mix(in oklch, var(--lh-late) 8%, var(--lh-surface));
        --lh-soon: color-mix(in oklch, var(--boxel-warning) 40%, var(--lh-ink));
        display: grid;
        gap: var(--boxel-sp);
        font-size: 0.875rem;
        color: var(--lh-ink);
        container-type: inline-size;
      }

      /* ---- sections: every zone announces itself the same way ---- */
      .band {
        display: grid;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border: 1px solid var(--lh-line);
        border-radius: var(--radius, var(--boxel-border-radius));
        background: var(--lh-surface);
      }
      .sec-head {
        display: grid;
        gap: 0.15rem;
      }
      h3 {
        margin: 0;
        font-size: 0.8125rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--lh-ink);
      }
      .sec-note {
        margin: 0;
        font-size: 0.8125rem;
        line-height: 1.45;
        color: var(--lh-muted);
        max-width: 60ch;
      }
      h4 {
        margin: 0 0 var(--boxel-sp-xxs);
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xxs);
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--lh-muted);
      }
      .h-n {
        font-variant-numeric: tabular-nums;
        color: var(--lh-ink);
      }

      /* ---- 1. hero ---- */
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 2fr);
        gap: var(--boxel-sp-lg);
        align-items: end;
        padding-top: var(--boxel-sp-xs);
      }
      .hero-fig {
        display: grid;
        gap: 0.2rem;
      }
      .hero-label,
      .tile-label {
        font-size: 0.6875rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--lh-muted);
      }
      .hero-value {
        font-size: clamp(2.5rem, 6cqi, 3.75rem);
        line-height: 1;
        font-weight: 600;
        letter-spacing: -0.02em;
        font-variant-numeric: proportional-nums;
      }
      .hero-sub {
        color: var(--lh-muted);
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--boxel-sp-sm);
      }
      .tile {
        display: grid;
        gap: 0.15rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border-left: 2px solid var(--lh-line);
      }
      .tile.u-urgent { border-left-color: var(--lh-warn); }
      .tile.u-late { border-left-color: var(--lh-late); }
      .tile-value {
        font-size: 1.75rem;
        line-height: 1.05;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .tile-sub {
        font-size: 0.75rem;
        color: var(--lh-muted);
      }
      .tile.u-late .tile-sub { color: var(--lh-late); font-weight: 600; }
      .tile.u-urgent .tile-sub { color: var(--lh-warn); }

      /* ---- the split: the book on the left, the to-do on the right ---- */
      .main {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(17rem, 1fr);
        gap: var(--boxel-sp);
        align-items: start;
      }
      .left {
        display: grid;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .right {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border: 1px solid var(--lh-line);
        border-radius: var(--radius, var(--boxel-border-radius));
        background: var(--lh-band);
        min-width: 0;
      }
      .queue {
        display: grid;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }

      /* ---- 2. runway ---- */
      .rw-grid {
        display: grid;
        gap: 2px;
      }
      .rw-axis,
      .rw-row {
        display: grid;
        grid-template-columns: minmax(8rem, 14rem) minmax(0, 1fr) auto 6.5rem;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .rw-axis {
        position: relative;
        height: 1.25rem;
        font-size: 0.6875rem;
        color: var(--lh-muted);
      }
      .rw-today {
        grid-column: 1;
        justify-self: end;
        padding-right: 0.4rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .rw-axis .rw-tick {
        grid-column: 2;
        grid-row: 1;
        position: relative;
        justify-self: start;
        transform: translateX(-50%);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .rw-row {
        min-height: 44px;
        padding: 0.35rem 0.5rem;
        border: 0;
        border-radius: var(--radius, 4px);
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .rw-row:hover,
      .rw-row:focus-visible {
        background: color-mix(in oklch, var(--lh-ink) 5%, transparent);
        outline: none;
      }
      .rw-row.u-late { background: var(--lh-late-bg); }
      .rw-title {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rw-plot {
        position: relative;
        height: 20px;
        min-width: 0;
      }
      .rw-grid-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--lh-line);
        opacity: 0.7;
      }
      .rw-bar {
        position: absolute;
        left: 0;
        top: 8px;
        height: 4px;
        border-radius: 0 2px 2px 0;
        background: var(--lh-ink);
      }
      .u-urgent .rw-bar { background: var(--lh-warn); }
      .u-soon .rw-bar { background: var(--lh-soon); }
      .rw-mark {
        position: absolute;
        top: 6px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--lh-ink);
        transform: translateX(-50%);
        box-shadow: 0 0 0 2px var(--lh-surface); /* surface ring */
      }
      .u-urgent .rw-mark { background: var(--lh-warn); }
      .u-late .rw-mark { background: var(--lh-late); }
      /* a contract without notice terms has no deadline to mark: its runway is
         the term itself, drawn quiet, ending at the hollow end mark */
      .k-expiry .rw-bar { background: var(--lh-muted); opacity: 0.55; }
      .k-expiry .rw-mark { display: none; }
      .rw-end {
        position: absolute;
        top: 6px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 1.5px solid var(--lh-ink);
        background: var(--lh-surface);
        box-sizing: border-box;
        transform: translateX(-50%);
        box-shadow: 0 0 0 2px var(--lh-surface);
      }
      .rw-days,
      .row-days {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 0.75rem;
        color: var(--lh-muted);
        white-space: nowrap;
      }
      .u-urgent .rw-days, .u-urgent .row-days { color: var(--lh-warn); font-weight: 600; }
      .u-late .rw-days, .u-late .row-days { color: var(--lh-late); font-weight: 700; }
      .rw-value {
        justify-self: end;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .rw-key {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.75rem;
        color: var(--lh-muted);
      }
      .rw-key > span { margin-left: 0.6rem; }
      .rw-key > span:first-child { margin-left: 0; }
      .key-bar { width: 18px; height: 4px; border-radius: 2px; background: var(--lh-ink); }
      .key-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lh-ink); }
      .key-ring { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--lh-ink); box-sizing: border-box; }

      /* ---- 3. pipeline rail ---- */
      .rail {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        align-items: start;
        padding-top: var(--boxel-sp-xs);
      }
      .stage {
        position: relative;
        display: grid;
        justify-items: start;
        gap: 0.45rem;
      }
      .node {
        position: relative;
        z-index: 1;
        display: inline-grid;
        place-items: center;
        min-width: 2rem;
        height: 2rem;
        padding: 0 0.5rem;
        border-radius: 999px;
        border: 1.5px solid var(--lh-line);
        background: var(--lh-surface);
        color: var(--lh-muted);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .stage.has .node {
        border-color: var(--lh-ink);
        background: var(--lh-ink);
        color: var(--lh-surface);
      }
      .track {
        position: absolute;
        top: 1rem;
        left: 2rem;
        right: 0;
        height: 1.5px;
        background: var(--lh-line);
      }
      .stage-label {
        font-size: 0.6875rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--lh-muted);
      }
      .stage.has .stage-label { color: var(--lh-ink); }

      /* ---- 4. queues ---- */
      .row-open {
        display: flex;
        min-width: 0;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: 100%;
        min-height: 44px;
        text-align: left;
        border: 1px solid var(--lh-line);
        border-radius: var(--radius, var(--boxel-border-radius));
        background: var(--lh-surface);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .row-open:hover { border-color: var(--lh-ink); }
      .row-open.u-late { background: var(--lh-late-bg); }
      .row-main {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
      }
      .row-name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-sub {
        font-size: 0.75rem;
        color: var(--lh-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-days,
      .row-open > :last-child { flex: none; }
      .empty {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--lh-muted);
        font-style: italic;
      }

      @container (max-width: 900px) {
        .main { grid-template-columns: 1fr; }
        .hero { grid-template-columns: 1fr; }
        .rw-axis, .rw-row { grid-template-columns: minmax(6rem, 10rem) minmax(0, 1fr) auto; }
        .rw-value { display: none; }
      }
      @container (max-width: 560px) {
        .band, .right { padding: var(--boxel-sp) var(--boxel-sp); }
        .tiles { grid-template-columns: 1fr; }
        .rail { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: var(--boxel-sp); }
        .stage:nth-child(3) .track { display: none; }
        .rw-axis, .rw-row { grid-template-columns: minmax(0, 1fr) auto; }
        .rw-plot { grid-column: 1 / -1; }
        .rw-axis .rw-tick, .rw-today { display: none; }
      }
    </style>
  </template>
}

function leftPct(x: number) {
  return htmlSafe(`left: ${x.toFixed(2)}%`);
}
function widthPct(x: number) {
  return htmlSafe(`width: ${x.toFixed(2)}%`);
}
function join(list: string[]) {
  return list.join(' · ');
}
function eq(a: unknown, b: unknown) {
  return a === b;
}
function concat(a: string, b: string) {
  return `${a}${b}`;
}

export default LegalHome;
