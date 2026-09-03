import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import MarkdownField from '@cardstack/base/markdown';
import { Command, identifyCard } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Contract } from '../contract';
import { ContractClause } from '../contract-clause';
import { Signatory } from '../signatory';
import { contractTypeLabel } from '../contract-type';
import { clauseTypeLabel } from '../clause';
import { formatMoney } from '../money';
import { formatDay } from '../effective-period-field';
import { governingLawLabel } from '../governing-law-field';
import { sortedBlocks } from '../signature-block-field';

// Generate Document — assembles the full agreement text from what the desk
// already knows, and writes it to the contract's `fullText`.
//
// Deterministic, not generative. The point of a clause playbook is that the
// document IS the clauses: every section's wording is either the library's
// approved text or a recorded deviation from it, and the parties, the term,
// the governing law and the signature lines are all structured fields. There
// is nothing for a model to invent, and anything it did invent would be a
// deviation nobody approved. So this is a template, not a prompt.
//
// Order of sections follows the conventional shape of a commercial agreement:
// parties → recitals/term → clauses (grouped in the clause-type order legal
// reads them) → governing law → signature blocks. Deviations are marked in
// the margin so a reader of the generated text can still see the playbook.

const CLAUSE_ORDER = [
  'payment',
  'liability',
  'indemnification',
  'confidentiality',
  'data_protection',
  'termination',
  'auto_renewal',
  'force_majeure',
  'other',
];

export class GenerateDocumentInput extends CardDef {
  @field contract = linksTo(() => Contract, { searchable: true });
  /**
   * The contract's clause instances, when the caller already holds them (an
   * app with a live ContractClause query). Optional: when absent the command
   * searches for them — but a search only reaches the realms the current
   * user lists as their own, so a consumer that has the clauses should pass
   * them rather than trust the search to see the realm.
   */
  @field clauses = linksToMany(() => ContractClause);
  /**
   * Our Signatory cards with their `person` resolved, when the caller has
   * them loaded (an app with a live Signatory query). The signer's NAME lives
   * two links away from the contract (block → Signatory → Employee), which a
   * command-side load does not reach; supplied instances do.
   */
  @field signatories = linksToMany(() => Signatory);
  /** Skip the write and only return the markdown. */
  @field previewOnly = contains(BooleanField);
}

export class GenerateDocumentResult extends CardDef {
  @field markdown = contains(MarkdownField);
  @field clauseCount = contains(NumberField);
  @field deviationCount = contains(NumberField);
  @field written = contains(BooleanField);
  @field message = contains(StringField);
}

function money(v?: { amount?: number | null; currency?: { code?: string | null } | null } | null) {
  return formatMoney(v?.amount ?? undefined, v?.currency?.code ?? undefined) || '—';
}

export function assembleDocument(
  contract: Contract,
  clauses: ContractClause[],
  /** Signer names by Signatory id, for blocks whose person link is not loaded. */
  signerNames: Record<string, string> = {},
): { markdown: string; deviationCount: number } {
  let lines: string[] = [];
  let title = contract.title?.trim() || 'Agreement';
  lines.push(`# ${title}`);
  if (contract.contractNumber) lines.push(`Reference ${contract.contractNumber}`);
  if (contract.contractType)
    lines.push(`${contractTypeLabel(contract.contractType)} agreement`);
  lines.push('');

  // ---- Parties ------------------------------------------------------------
  let parties = (contract.parties ?? []).filter(Boolean);
  lines.push('## Parties');
  if (parties.length) {
    parties.forEach((p, i) => {
      let e = p.entity;
      let name = e?.legalName ?? 'Unnamed entity';
      let where = [e?.jurisdiction, e?.registrationNumber].filter(Boolean).join(', ');
      let role = p.roleLabel ?? 'Party';
      let article = /^the\s/i.test(role) ? '' : 'the ';
      lines.push(
        `${i + 1}. **${name}**${where ? ` (${where})` : ''} — ${article}"${role}"`,
      );
    });
  } else {
    lines.push('_No parties recorded._');
  }
  lines.push('');

  // ---- Term ---------------------------------------------------------------
  let ep = contract.effectivePeriod;
  lines.push('## Term and value');
  if (ep?.effectiveDate || ep?.endDate) {
    lines.push(
      `This agreement is effective from ${formatDay(ep.effectiveDate)} and ends on ${formatDay(ep.endDate)}${
        ep.termMonths ? ` (${ep.termMonths} months)` : ''
      }.`,
    );
    if (ep.autoRenews) {
      lines.push(
        `It renews automatically${
          ep.renewalTermMonths ? ` for successive terms of ${ep.renewalTermMonths} months` : ''
        } unless either party gives written notice of non-renewal${
          ep.noticeDays ? ` at least ${ep.noticeDays} days before the end of the then-current term` : ''
        }${ep.noticeDeadline ? ` — for the current term, by **${formatDay(ep.noticeDeadline)}**` : ''}.`,
      );
    } else {
      lines.push('It does not renew automatically.');
    }
  } else if (contract.startDate || contract.endDate) {
    lines.push(
      `This agreement runs from ${formatDay(contract.startDate)} to ${formatDay(contract.endDate)}.`,
    );
  } else {
    lines.push('_Term not yet set._');
  }
  if (contract.value?.amount != null) {
    lines.push(`Total contract value: **${money(contract.value)}**.`);
  }
  lines.push('');

  // ---- Clauses ------------------------------------------------------------
  let ordered = clauses
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      let ai = CLAUSE_ORDER.indexOf(a.clauseType ?? 'other');
      let bi = CLAUSE_ORDER.indexOf(b.clauseType ?? 'other');
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  let deviationCount = 0;
  lines.push('## Terms');
  if (ordered.length) {
    ordered.forEach((c, i) => {
      let heading = c.standardClause?.name?.trim() || clauseTypeLabel(c.clauseType);
      lines.push(`### ${i + 1}. ${heading}`);
      let text = c.actualText?.trim() || c.standardClause?.standardText?.trim();
      if (c.isDeviation) {
        deviationCount++;
        lines.push(
          `> **Deviation from playbook** (${c.deviationSeverity ?? 'unrated'})${
            c.deviationNotes ? ` — ${c.deviationNotes.trim()}` : ''
          }`,
        );
      }
      lines.push(text || '_No text recorded for this clause._');
      lines.push('');
    });
  } else if (contract.terms?.trim()) {
    lines.push(contract.terms.trim());
    lines.push('');
  } else {
    lines.push('_No clauses attached to this agreement._');
    lines.push('');
  }

  // ---- Governing law ------------------------------------------------------
  let gl = contract.governingLaw;
  if (gl?.jurisdiction || gl?.venue) {
    lines.push('## Governing law and disputes');
    lines.push(
      `This agreement is governed by the law of **${gl.jurisdiction ?? '—'}**${
        gl.venue ? `; disputes are submitted to **${gl.venue}**` : ''
      }. (${governingLawLabel(gl.jurisdiction, gl.venue)})`,
    );
    if (gl.notes?.trim()) lines.push(gl.notes.trim());
    lines.push('');
  }

  // ---- Signature blocks ---------------------------------------------------
  let blocks = sortedBlocks(contract.signatureBlocks);
  lines.push('## Signatures');
  if (blocks.length) {
    lines.push('Signed for and on behalf of the parties, in the order below.');
    lines.push('');
    for (let b of blocks) {
      lines.push(`**${b.entityName || 'Party'}**${b.party?.roleLabel ? ` (${b.party.roleLabel})` : ''}`);
      lines.push('');
      lines.push(
        `Signed: ${b.lineStatus === 'signed' ? '✓' : '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_'}`,
      );
      // Our side: the name comes from the Signatory's person. When that link
      // is not resolved here, leave the name line blank rather than print the
      // title where a name belongs — a signature page never guesses a name.
      let resolved = b.signatory?.id ? signerNames[b.signatory.id] : undefined;
      let personName = (() => {
        try {
          return b.signatory?.person?.name?.trim();
        } catch {
          return undefined;
        }
      })();
      let name = b.signatory
        ? resolved || personName || '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_'
        : b.signerName?.trim() || '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_';
      let title = b.signatory
        ? b.signatory.signingTitle?.trim() ?? ''
        : b.signerTitle?.trim() ?? '';
      lines.push(`Name: ${name}`);
      if (title) lines.push(`Title: ${title}`);
      lines.push(
        `Date: ${b.signedAt ? formatDay(b.signedAt) : '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_'}`,
      );
      if (b.signatureRef) lines.push(`Ref: \`${b.signatureRef}\``);
      lines.push('');
    }
  } else {
    lines.push('_No signature blocks recorded._');
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `_Generated ${formatDay(new Date())} from the clause library and the agreement record. Deviations are marked where the wording departs from approved text._`,
  );

  return { markdown: lines.join('\n'), deviationCount };
}

export default class GenerateDocumentCommand extends Command<
  typeof GenerateDocumentInput,
  typeof GenerateDocumentResult
> {
  static actionVerb = 'Generate Document';
  static displayName = 'Generate Document';

  async getInputType() {
    return GenerateDocumentInput;
  }

  protected async run(
    input: GenerateDocumentInput,
  ): Promise<GenerateDocumentResult> {
    let { contract, previewOnly } = input;
    let supplied = (input.clauses ?? []).filter(Boolean) as ContractClause[];
    if (!contract) {
      throw new Error('A contract is required');
    }
    if (contract.id) {
      contract = (await new GetCardCommand(this.commandContext).execute({
        cardId: contract.id,
      })) as Contract;
    }

    // The contract's clause instances link UP to it, so they are found by
    // query rather than read off a field.
    // Filtered in the query on the relationship, not client-side: search
    // results arrive with their own links unresolved, so `c.contract?.id`
    // would be undefined for every row and the document would have no clauses.
    let clauses: ContractClause[] = supplied.filter((c) => {
      try {
        return !c.contract?.id || c.contract.id === contract!.id;
      } catch {
        return true;
      }
    });
    let ref = identifyCard(ContractClause);
    if (!clauses.length && ref && contract.id) {
      let result = await new SearchCardsByQueryCommand(
        this.commandContext,
      ).execute({
        query: {
          filter: { on: ref, eq: { 'contract.id': contract.id } },
        },
      });
      clauses = ((result.instances ?? []) as ContractClause[]).filter(Boolean);
    }

    // Our signatories' names live one link further than the contract load
    // reaches (block → Signatory → Employee), so fetch each Signatory once.
    let signerNames: Record<string, string> = {};
    for (let s of (input.signatories ?? []) as Signatory[]) {
      try {
        let name = s?.person?.name?.trim();
        if (s?.id && name) signerNames[s.id] = name;
      } catch {
        // unresolved person on a supplied signatory; fall through to fetch
      }
    }
    for (let b of contract.signatureBlocks ?? []) {
      let id = b?.signatory?.id;
      if (!id || signerNames[id]) continue;
      try {
        let s = (await new GetCardCommand(this.commandContext).execute({
          cardId: id,
        })) as any;
        let name = s?.person?.name?.trim();
        if (name) signerNames[id] = name;
      } catch {
        // leave unresolved; the block's own fallback naming applies
      }
    }

    let { markdown, deviationCount } = assembleDocument(
      contract,
      clauses,
      signerNames,
    );

    let written = false;
    if (!previewOnly && contract.id) {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Contract,
      }).execute({
        cardId: contract.id,
        patch: { attributes: { fullText: markdown } },
      });
      written = true;
    }

    return new GenerateDocumentResult({
      markdown,
      clauseCount: clauses.length,
      deviationCount,
      written,
      message: written
        ? `Document assembled for "${contract.title ?? 'Contract'}" — ${clauses.length} clauses (${deviationCount} deviations), written to fullText.`
        : `Document assembled for "${contract.title ?? 'Contract'}" — ${clauses.length} clauses (${deviationCount} deviations). Preview only; nothing written.`,
    });
  }
}
