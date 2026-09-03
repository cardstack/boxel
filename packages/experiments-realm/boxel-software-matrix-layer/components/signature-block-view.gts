import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import SignatureIcon from '@cardstack/boxel-icons/signature';
import CircleCheckIcon from '@cardstack/boxel-icons/circle-check';
import CircleXIcon from '@cardstack/boxel-icons/circle-x';

import {
  type SignatureBlockField,
  type CeremonyFinding,
  SIGNATURE_BLOCK_STATUS_HUE,
  signatureBlockStatusLabel,
  sortedBlocks,
  verifyCeremony,
  ceremonyIsClean,
  ceremonyState,
} from '../signature-block-field';
import { StatePill } from './state-pill';
import { formatMoney } from '../money';
import type { Hue } from '../utils/index';

interface Signature {
  Args: {
    blocks?: SignatureBlockField[] | null;
    /** The document's value — what every authority ceiling is checked against. */
    contractValue?: number | null;
    contractCurrency?: string | null;
    /** The document's type — what every signatory's remit is checked against. */
    contractType?: string | null;
    /** Heading over the strip. Defaults to "Signature ceremony". */
    title?: string;
    /** Hide the verdict footer (for a read-only summary in a list). */
    compact?: boolean;
  };
  Element: HTMLElement;
}

interface Line {
  block: SignatureBlockField;
  order: number;
  name: string;
  title: string;
  entity: string;
  role: string;
  status: string;
  hue: Hue;
  when?: string;
  authority?: string;
  authorityOk?: boolean;
  problems: string[];
}

function day(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  let t = new Date(d);
  if (!Number.isFinite(t.getTime())) return undefined;
  return t.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Signature Block View (SB) — the ceremony as a document reader sees it.
 *
 * One card per signature line, in signing order, each carrying the party,
 * the signer, the authority ceiling with a pass/fail mark, and what has
 * happened. Below them, one line of verdict: either "all authority checks
 * pass" or the exact reasons they do not.
 *
 * Render-only. Every check is `verifyCeremony` from signature-block-field —
 * the same function Request Signature and Execute Contract run — so what the
 * screen says and what the commands enforce cannot disagree.
 *
 * The ceremony is deliberately slow-looking: document-grade type, no motion,
 * a full-width strip rather than a toast. Signing is the one irreversible
 * moment in a contract's life and should look like it.
 */
export class SignatureBlockView extends GlimmerComponent<Signature> {
  get findings(): CeremonyFinding[] {
    return verifyCeremony(
      this.args.blocks,
      this.args.contractValue,
      this.args.contractType,
    );
  }

  get clean(): boolean {
    return this.args.blocks?.length ? ceremonyIsClean(this.findings) : false;
  }

  get state() {
    return ceremonyState(this.args.blocks);
  }

  get valueLabel(): string | undefined {
    return formatMoney(
      this.args.contractValue ?? undefined,
      this.args.contractCurrency ?? undefined,
    );
  }

  get lines(): Line[] {
    let findings = this.findings;
    return sortedBlocks(this.args.blocks).map((b) => {
      let order = b.signingOrder ?? 0;
      let problems = findings
        .filter((f) => f.order === order && f.order !== 0)
        .map((f) => f.message);
      let s = b.signatory;
      let authority = s
        ? formatMoney(
            s.signatureAuthority?.amount,
            s.signatureAuthority?.currency?.code,
          )
        : undefined;
      let authorityOk = s
        ? s.canSign(this.args.contractValue, this.args.contractType).allowed
        : undefined;
      // Read the person through the link here, in a tracked getter, rather
      // than trusting the block's computed `displayName`: a FieldDef computed
      // is evaluated before a two-hop link (block → Signatory → Employee) has
      // resolved and is not re-run when it does; a Glimmer getter is.
      let personName: string | undefined;
      try {
        personName = s?.person?.name?.trim();
      } catch {
        personName = undefined;
      }
      let external = b.signerName?.trim();
      let name = personName || external || (s ? s.signingTitle?.trim() : '') || 'Signer not named';
      let title =
        personName || external
          ? (s?.signingTitle?.trim() || b.signerTitle?.trim() || '')
          : '';
      return {
        block: b,
        order,
        name,
        title,
        entity: b.entityName || 'Party not set',
        role: b.party?.roleLabel ?? '',
        status: b.lineStatus ?? 'pending',
        hue: SIGNATURE_BLOCK_STATUS_HUE[b.lineStatus ?? 'pending'] ?? 'slate',
        when: day(b.signedAt ?? b.requestedAt),
        authority: authority || (s ? 'no authority recorded' : undefined),
        authorityOk,
        problems,
      };
    });
  }

  get countStyle() {
    return htmlSafe(`--cy-count: ${this.lines.length}`);
  }

  get globalFindings(): CeremonyFinding[] {
    return this.findings.filter((f) => f.order === 0);
  }

  get verdict(): string {
    if (!this.args.blocks?.length) return 'No signature blocks yet — add the signers on the contract before requesting signatures.';
    let n = this.findings.filter((f) => f.level === 'block').length;
    if (n === 0) {
      let v = this.valueLabel;
      return v
        ? `Document value ${v} — all authority checks pass.`
        : 'All authority checks pass.';
    }
    return `${n} ${n === 1 ? 'check fails' : 'checks fail'} — the document cannot be executed until each is cleared.`;
  }

  <template>
    <section class='ceremony state-{{this.state}}' style={{this.countStyle}} ...attributes>
      <header class='cy-head'>
        <SignatureIcon class='cy-icon' role='presentation' />
        <h3 class='cy-title'>{{if @title @title 'Signature ceremony'}}</h3>
        <StatePill
          @label={{this.state}}
          @hue={{if (eqs this.state 'complete') 'green' (if (eqs this.state 'declined') 'red' (if (eqs this.state 'in progress') 'amber' 'slate'))}}
          @dot={{true}}
        />
      </header>

      {{#if this.lines.length}}
        <ol class='cy-lines'>
          {{#each this.lines as |l index|}}
            <li
              class='cy-line is-{{l.status}} {{if l.problems.length "has-problem"}}'
              style={{lineDelay index}}
            >
              <div class='cl-party'>
                <span class='cl-order'>{{l.order}}.</span>
                <span class='cl-entity'>{{l.entity}}</span>
                {{#if l.role}}<span class='cl-role'>({{l.role}})</span>{{/if}}
              </div>
              <div class='cl-card'>
                <p class='cl-signer'>
                  <span class='cl-name'>{{l.name}}</span>{{~#if l.title}}<span class='cl-title'>, {{l.title}}</span>{{/if}}
                </p>
                {{#if l.authority}}
                  <p class='cl-auth {{if l.authorityOk "ok" "fail"}}'>
                    {{#if l.authorityOk}}
                      <CircleCheckIcon class='cl-mark' role='presentation' />
                    {{else}}
                      <CircleXIcon class='cl-mark' role='presentation' />
                    {{/if}}
                    authority {{l.authority}}
                  </p>
                {{else}}
                  <p class='cl-auth external'>counterparty signer — authority not ours to check</p>
                {{/if}}
                <p class='cl-status'>
                  <StatePill
                    @label={{signatureBlockStatusLabel l.status}}
                    @hue={{l.hue}}
                    @dot={{true}}
                    @emphatic={{eqs l.status 'signed'}}
                  />
                  {{#if l.when}}<span class='cl-when'>{{l.when}}</span>{{/if}}
                </p>
                {{#if l.block.signatureRef}}
                  <p class='cl-ref'>{{l.block.signatureRef}}</p>
                {{/if}}
                {{#if l.problems.length}}
                  <ul class='cl-problems'>
                    {{#each l.problems as |p|}}<li>{{p}}</li>{{/each}}
                  </ul>
                {{/if}}
              </div>
            </li>
          {{/each}}
        </ol>
      {{/if}}

      {{#unless @compact}}
        <footer class='cy-foot {{if this.clean "is-clean" "is-blocked"}}'>
          <span class='cy-seal' aria-hidden='true'>
            {{#if this.clean}}
              <CircleCheckIcon class='cy-mark' role='presentation' />
            {{else}}
              <CircleXIcon class='cy-mark' role='presentation' />
            {{/if}}
          </span>
          <p class='cy-verdict'>{{this.verdict}}</p>
          {{#if (and this.globalFindings.length this.lines.length)}}
            <ul class='cy-global'>
              {{#each this.globalFindings as |f|}}<li>{{f.message}}</li>{{/each}}
            </ul>
          {{/if}}
        </footer>
      {{/unless}}
    </section>
    <style scoped>
      .ceremony {
        /* Status hues are data: green means signed and red means blocked
           whatever the theme. Text is pulled toward the card's own foreground
           so the pair survives a dark theme (boxel-theming §2). */
        --cy-ok-fg: color-mix(in oklch, var(--boxel-success) 65%, var(--foreground, var(--boxel-dark)));
        --cy-ok-bg: color-mix(in oklch, var(--cy-ok-fg) 10%, var(--background, var(--boxel-light)));
        --cy-bad-fg: color-mix(in oklch, var(--boxel-danger) 70%, var(--foreground, var(--boxel-dark)));
        --cy-bad-bg: color-mix(in oklch, var(--cy-bad-fg) 10%, var(--background, var(--boxel-light)));
        --cy-seal: color-mix(in oklch, var(--boxel-purple) 55%, var(--foreground, var(--boxel-dark)));
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        padding: 1rem 1.1rem 0.9rem;
        border: 1px solid var(--border, var(--boxel-200));
        border-top: 3px solid var(--cy-seal);
        border-radius: var(--boxel-border-radius, 6px);
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
        container-type: inline-size;
      }
      .cy-head {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      .cy-icon {
        width: 18px;
        height: 18px;
        color: var(--cy-seal);
        flex: none;
      }
      .cy-title {
        margin: 0;
        flex: 1;
        font-family: var(--font-heading, inherit);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .cy-lines {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 0.9rem;
      }
      .cy-line {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-width: 0;
        /* Lines rise onto the page in signing order — slow and deliberate, the
           pace of a document being passed down the table. Data carries the
           urgency; motion carries only the order. */
        animation: cy-rise 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        animation-delay: calc(120ms + var(--cy-i, 0) * 140ms);
      }
      @keyframes cy-rise {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .cy-foot {
        animation: cy-seal-in 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        animation-delay: calc(260ms + var(--cy-count, 2) * 140ms);
      }
      @keyframes cy-seal-in {
        from {
          opacity: 0;
          transform: scale(0.985);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .cy-line,
        .cy-foot {
          animation: none;
        }
      }
      .cl-party {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .cl-order {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-weight: 700;
      }
      .cl-entity {
        font-weight: 700;
        color: var(--foreground, var(--boxel-dark));
      }
      .cl-role {
        text-transform: none;
        letter-spacing: 0;
      }
      .cl-card {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.7rem 0.8rem;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: var(--background, var(--boxel-light));
        min-height: 6.5rem;
      }
      .cy-line.is-signed .cl-card {
        border-color: color-mix(in oklch, var(--boxel-success) 45%, var(--border, var(--boxel-200)));
      }
      .cy-line.has-problem .cl-card {
        border-color: color-mix(in oklch, var(--boxel-danger) 55%, var(--border, var(--boxel-200)));
        background: var(--cy-bad-bg);
      }
      .cl-signer {
        margin: 0;
        font-family: var(--font-heading, inherit);
        font-size: 1.05rem;
        line-height: 1.3;
      }
      .cl-name {
        font-weight: 600;
      }
      .cl-title {
        color: var(--muted-foreground, var(--boxel-450));
      }
      .cl-auth {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: var(--boxel-font-size-xs);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .cl-auth.ok {
        color: var(--cy-ok-fg);
      }
      .cl-auth.fail {
        color: var(--cy-bad-fg);
        font-weight: 600;
      }
      .cl-auth.external {
        font-style: italic;
      }
      .cl-mark {
        width: 13px;
        height: 13px;
        flex: none;
      }
      .cl-status {
        margin: 0.1rem 0 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .cl-ref {
        margin: 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cl-problems {
        margin: 0.2rem 0 0;
        padding-left: 1rem;
        font-size: var(--boxel-font-size-xs);
        color: var(--cy-bad-fg);
        line-height: 1.45;
      }
      .cy-foot {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 0.2rem 0.7rem;
        padding: 0.6rem 0.75rem;
        border-radius: var(--boxel-border-radius-sm, 4px);
        font-size: var(--boxel-font-size-sm);
      }
      .cy-foot.is-clean {
        background: var(--cy-ok-bg);
        color: var(--cy-ok-fg);
      }
      .cy-foot.is-blocked {
        background: var(--cy-bad-bg);
        color: var(--cy-bad-fg);
      }
      /* The seal: a ringed mark, the one ceremonial flourish on the strip. */
      .cy-seal {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1.5px solid currentColor;
        box-shadow: inset 0 0 0 3px var(--card, var(--boxel-light)),
          inset 0 0 0 4px currentColor;
        flex: none;
      }
      .cy-mark {
        width: 15px;
        height: 15px;
      }
      .cy-verdict {
        margin: 0;
        font-weight: 600;
      }
      .cy-global {
        grid-column: 2;
        margin: 0;
        padding-left: 1rem;
        line-height: 1.45;
      }
      @container (max-width: 420px) {
        .cy-lines {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

function eqs(a?: string | null, b?: string) {
  return a === b;
}
function and(a: unknown, b: unknown) {
  return Boolean(a) && Boolean(b);
}

/** Per-line entrance delay, so the ceremony reads in signing order. */
function lineDelay(index: number) {
  return htmlSafe(`--cy-i: ${index}`);
}

export default SignatureBlockView;
