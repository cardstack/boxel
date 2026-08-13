import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

// How one CSV column becomes one field on the card. `parse` is the consumer's
// job because only it knows that "8/14/2026" is this card's dueDate and that
// "4,200.00" is money rather than a string.
export interface ImportColumn {
  header: string;
  field: string;
  required?: boolean;
  parse?: (raw: string) => unknown;
}

export interface ImportRowResult {
  row: number;
  ok: boolean;
  error?: string;
  id?: string;
}

// RFC 4180: quoted cells may contain commas, newlines and doubled quotes.
export function parseCsv(text: string): string[][] {
  let rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  let input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    let char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      cell = '';
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

// Turns parsed text into per-row attribute objects. A row that cannot be
// mapped fails on its own rather than taking the file down with it.
export function mapRows(
  rows: string[][],
  columns: ImportColumn[],
): { attributes?: Record<string, unknown>; error?: string }[] {
  let [header = [], ...body] = rows;
  let index = new Map(
    header.map((h, i) => [h.trim().toLowerCase(), i] as [string, number]),
  );
  let missing = columns
    .filter((c) => c.required && !index.has(c.header.trim().toLowerCase()))
    .map((c) => c.header);
  if (missing.length) {
    return body.map(() => ({
      error: `File is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    }));
  }

  return body.map((cells) => {
    let attributes: Record<string, unknown> = {};
    for (let column of columns) {
      let at = index.get(column.header.trim().toLowerCase());
      let raw = at === undefined ? '' : (cells[at] ?? '').trim();
      if (!raw) {
        if (column.required) {
          return { error: `${column.header} is empty` };
        }
        continue;
      }
      try {
        attributes[column.field] = column.parse ? column.parse(raw) : raw;
      } catch (e: any) {
        return { error: `${column.header}: ${e?.message ?? 'could not be read'}` };
      }
    }
    return { attributes };
  });
}

interface ImportButtonSignature {
  Args: {
    cardType: typeof CardDef;
    columns: ImportColumn[];
    commandContext: any;
    label?: string;
    onComplete?: (results: ImportRowResult[]) => void;
    realm: string;
  };
  Element: HTMLElement;
}

export class ImportButton extends GlimmerComponent<ImportButtonSignature> {
  @tracked busy = false;

  @action async pick(event: Event) {
    let input = event.target as HTMLInputElement;
    let file = input.files?.[0];
    if (!file) return;
    this.busy = true;
    try {
      let results = await this.ingest(await file.text());
      this.args.onComplete?.(results);
    } finally {
      this.busy = false;
      // Let the same file be picked again after a failed run.
      input.value = '';
    }
  }

  private async ingest(text: string): Promise<ImportRowResult[]> {
    let mapped = mapRows(parseCsv(text), this.args.columns);
    let results: ImportRowResult[] = [];
    for (let [i, entry] of mapped.entries()) {
      // Rows are numbered as the spreadsheet shows them: 1 is the header.
      let row = i + 2;
      if (entry.error || !entry.attributes) {
        results.push({ row, ok: false, error: entry.error });
        continue;
      }
      try {
        let card = (await new SaveCardCommand(this.args.commandContext).execute({
          card: new (this.args.cardType as any)(),
          realm: this.args.realm,
        } as any)) as CardDef;
        await new PatchCardInstanceCommand(this.args.commandContext, {
          cardType: this.args.cardType,
        }).execute({
          cardId: card.id,
          patch: { attributes: entry.attributes },
        });
        results.push({ row, ok: true, id: card.id });
      } catch (e: any) {
        results.push({ row, ok: false, error: e?.message ?? 'Could not be saved' });
      }
    }
    return results;
  }

  <template>
    <label class='import' ...attributes>
      <span class='label'>{{if this.busy 'Importing…' (if @label @label 'Import CSV')}}</span>
      <input
        type='file'
        accept='.csv,text/csv'
        disabled={{this.busy}}
        {{on 'change' this.pick}}
      />
    </label>
    <style scoped>
      .import {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border, #d1d5db);
        border-radius: 6px;
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        background: var(--card, #ffffff);
        color: var(--foreground, #111111);
      }
      .import:hover {
        background: var(--muted, #f3f4f6);
      }
      input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
    </style>
  </template>
}
