import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { BoxelButton } from '@cardstack/boxel-ui/components';

// The minimal shape Export needs. A Table column already satisfies it, so the
// two blocks compose without Export depending on Table.
export interface ExportColumn<T = any> {
  key: string;
  label?: string;
  value: (item: T) => string | number | null | undefined;
  // Opt a column out of its display form when the two differ — a raw number
  // where value renders "$4,200.00", so the column sums in a spreadsheet.
  exportValue?: (item: T) => string | number | null | undefined;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  preamble?: string[],
): string {
  let header = columns.map((c) => escapeCell(c.label ?? c.key));
  let body = rows.map((row) =>
    columns.map((c) => escapeCell((c.exportValue ?? c.value)(row))),
  );
  let table = [header, ...body].map((cells) => cells.join(',')).join('\r\n');
  // `# `-prefixed lines carry facts that hold for the whole file (export date,
  // a stripped URL prefix) so they aren't repeated into every row.
  let comments = (preamble ?? []).map((line) => `# ${line}`).join('\r\n');
  return comments ? `${comments}\r\n${table}` : table;
}

export function downloadCsv(filename: string, csv: string): void {
  // The BOM keeps Excel from mangling non-ASCII on open.
  let blob = new Blob([`\uFEFF${csv}`], {
    type: 'text/csv;charset=utf-8;',
  });
  let url = URL.createObjectURL(blob);
  let link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface ExportButtonSignature {
  Args: {
    columns: ExportColumn[];
    filename: string;
    label?: string;
    preamble?: string[];
    rows: unknown[];
  };
  Element: HTMLElement;
}

export class ExportButton extends GlimmerComponent<ExportButtonSignature> {
  @action download() {
    downloadCsv(
      this.args.filename,
      toCsv(this.args.rows, this.args.columns, this.args.preamble),
    );
  }

  <template>
    <BoxelButton
      @kind='secondary'
      @size='extra-small'
      @disabled={{this.isEmpty}}
      {{on 'click' this.download}}
      ...attributes
    >{{if @label @label 'Export CSV'}}</BoxelButton>
  </template>

  get isEmpty() {
    return !this.args.rows?.length;
  }
}
