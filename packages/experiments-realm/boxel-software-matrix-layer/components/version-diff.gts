import GlimmerComponent from '@glimmer/component';
import { formatMoney } from '../money';

interface DiffRow {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

interface Signature {
  Args: {
    /** Older version first. */
    before?: any;
    after?: any;
  };
  Element: HTMLElement;
}

/**
 * VERSION DIFF — what an amendment actually changed.
 *
 * WHY FIELD-LEVEL, not text diff. The spec asks to "diff two versions, show
 * changes", and a word-level diff of contract prose is a negotiation-redlining
 * feature the spec puts explicitly out of scope. What a reviewer needs here is
 * narrower and more answerable: did the value, the end date or the signing
 * party move between versions, and by how much.
 *
 * UNCHANGED ROWS ARE KEPT, not hidden. A diff that shows only what moved makes
 * the reader guess whether an absent field was unchanged or simply not
 * recorded — and "the end date didn't change" is itself a finding when someone
 * expected it to.
 */
export class VersionDiff extends GlimmerComponent<Signature> {
  private money(v: any): string {
    return formatMoney(v?.amount, v?.currency?.code) || '—';
  }

  private day(v: any): string {
    if (!v) return '—';
    let d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    let m = `${d.getMonth() + 1}`.padStart(2, '0');
    let day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  get rows(): DiffRow[] {
    let a: any = this.args.before;
    let b: any = this.args.after;
    let make = (label: string, before: string, after: string): DiffRow => ({
      label,
      before,
      after,
      changed: before !== after,
    });
    return [
      make('Value', this.money(a?.valueAtVersion), this.money(b?.valueAtVersion)),
      make('End date', this.day(a?.endDateAtVersion), this.day(b?.endDateAtVersion)),
      make(
        'Executed by',
        a?.executedBy?.cardTitle ?? '—',
        b?.executedBy?.cardTitle ?? '—',
      ),
      make('Effective', this.day(a?.effectiveDate), this.day(b?.effectiveDate)),
    ];
  }

  get hasBoth(): boolean {
    return Boolean(this.args.before && this.args.after);
  }

  get changedCount(): number {
    return this.rows.filter((r) => r.changed).length;
  }

  <template>
    <div class='vd' ...attributes>
      {{#if this.hasBoth}}
        <p class='vd-sum'>
          {{#if this.changedCount}}
            {{this.changedCount}} of {{this.rows.length}} tracked fields changed.
          {{else}}
            No tracked field changed between these versions.
          {{/if}}
        </p>
        <table class='vd-t'>
          <thead>
            <tr>
              <th scope='col'>Field</th>
              <th scope='col'>Before</th>
              <th scope='col'>After</th>
            </tr>
          </thead>
          <tbody>
            {{#each this.rows as |r|}}
              <tr class='{{if r.changed "is-changed"}}'>
                <th scope='row'>{{r.label}}</th>
                <td class='vd-was'>{{r.before}}</td>
                <td class='vd-now'>{{r.after}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      {{else}}
        <p class='vd-empty'>Pick two versions to compare.</p>
      {{/if}}
    </div>

    <style scoped>
      .vd {
        container-type: inline-size;
        font-family: var(--font-sans, inherit);
      }
      .vd-sum {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, #6b7280);
      }
      .vd-t {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--boxel-font-size-sm);
      }
      .vd-t th[scope='col'] {
        text-align: left;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted-foreground, #6b7280);
        padding: 6px 8px;
        border-bottom: 1px solid var(--border, #dde2df);
      }
      .vd-t th[scope='row'] {
        text-align: left;
        font-weight: 550;
        padding: 8px;
      }
      .vd-t td {
        padding: 8px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .vd-t tbody tr { border-bottom: 1px solid var(--border, #dde2df); }
      /* A change is marked by weight and a rule, not by colour alone. */
      .is-changed th[scope='row']::after {
        content: ' changed';
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 9px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--boxel-warning, #9a6a12);
        margin-left: 6px;
      }
      .is-changed .vd-was {
        color: var(--muted-foreground, #6b7280);
        text-decoration: line-through;
      }
      .is-changed .vd-now { font-weight: 700; }
      .vd-empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, #6b7280);
      }
    </style>
  </template>
}

export default VersionDiff;
