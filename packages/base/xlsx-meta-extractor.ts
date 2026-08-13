// Reads an Excel workbook (`.xlsx`) for its identity, its sheet names, and a
// bounded sample of the first sheet's grid. Sheet names come from
// `xl/workbook.xml`; a cell's value is either inline or — for text — an index
// into the shared string table (`xl/sharedStrings.xml`), the compression Excel
// uses so a value repeated across a column is stored once. The preview places
// the sampled cells by their `A1` references into a dense top-left window, which
// is what the spreadsheet's embedded and isolated previews render as a grid.

import {
  OoxmlPackage,
  decodeXmlEntities,
  pruneUndefined,
  readCoreProperties,
  type GridPreview,
  type GridSheet,
  type OfficeMetadata,
} from './ooxml';

// A workbook's shape shows in its first sheet's top-left corner; the rest is
// scrolled to in the real file. Bounds keep the sampled grid small.
const MAX_ROWS = 20;
const MAX_COLS = 12;
const MAX_CELL_CHARS = 64;
const MAX_SHEET_NAMES = 50;

// The shared string table: each `<si>` is one entry, its text the concatenation
// of its `<t>` runs (a rich-text string is split across runs). Indexed by order.
function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) => {
    let runs = [...si[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    return runs.map((m) => decodeXmlEntities(m[1]!)).join('');
  });
}

// `A1` → column index 0, `AA10` → 26. Only the letter run matters.
function columnIndex(ref: string): number {
  let letters = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

// One cell's value as display text, whitespace collapsed so a multi-line cell
// stays one line in the compact sampled grid.
function cellText(cell: string, sharedStrings: string[]): string {
  let collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  let type = cell.match(/\bt="([^"]*)"/)?.[1] ?? '';
  if (type === 'inlineStr') {
    let t = cell.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
    return t ? collapse(decodeXmlEntities(t[1]!)) : '';
  }
  let v = cell.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
  let raw = v ? decodeXmlEntities(v[1]!) : '';
  if (type === 's') {
    let index = Number(raw);
    return collapse(sharedStrings[index] ?? '');
  }
  if (type === 'b') {
    return raw === '1' ? 'TRUE' : 'FALSE';
  }
  // Numbers, dates (stored as serial numbers), and formula strings come through
  // as their literal value — honest, without inventing a date format the file
  // only implies through a style.
  return collapse(raw);
}

// Place the sheet's sampled cells into a dense grid. Rows and columns can be
// sparse in the XML (Excel omits empty ones), so cells are positioned by their
// `A1` reference rather than by document order, and gaps become empty strings.
function readSheetGrid(
  sheetXml: string,
  name: string,
  sharedStrings: string[],
): GridSheet {
  let rows: string[][] = [];
  let truncated = false;
  let maxCols = 0;
  let rowMatches = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
  for (let rowMatch of rowMatches) {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    let cells = [
      ...rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g),
    ];
    let row: string[] = [];
    for (let cell of cells) {
      let ref = cell[1]!.match(/\br="([A-Z]+\d+)"/)?.[1] ?? '';
      let col = ref ? columnIndex(ref) : row.length;
      if (col >= MAX_COLS) {
        truncated = true;
        continue;
      }
      // `cell[2]` is undefined for a self-closing (empty) `<c .../>`.
      let text = cell[2] ? cellText(cell[0]!, sharedStrings) : '';
      while (row.length <= col) {
        row.push('');
      }
      row[col] =
        text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text;
    }
    maxCols = Math.max(maxCols, row.length);
    rows.push(row);
  }
  // Pad every row to the widest so the grid is rectangular for the renderer.
  for (let row of rows) {
    while (row.length < maxCols) {
      row.push('');
    }
  }
  return { name, rows, truncated };
}

function sheetNames(workbookXml: string): string[] {
  return [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)]
    .map((m) => decodeXmlEntities(m[1]!))
    .slice(0, MAX_SHEET_NAMES);
}

// The first worksheet part in numeric order — the sheet a preview samples.
function firstSheetPart(pkg: OoxmlPackage): string | undefined {
  return pkg
    .names()
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => {
      let na = Number(a.match(/sheet(\d+)\.xml$/)![1]);
      let nb = Number(b.match(/sheet(\d+)\.xml$/)![1]);
      return na - nb;
    })[0];
}

// Read a `.xlsx`'s facts, its sheet names, and a bounded sample of the first
// sheet. Throws `FileContentMismatchError` (via `OoxmlPackage.open`) when the
// bytes aren't an OOXML package. A workbook whose cells won't read still returns
// its sheet names and count.
export async function extractXlsxMetadata(
  bytes: Uint8Array,
): Promise<OfficeMetadata> {
  let pkg = await OoxmlPackage.open(bytes);
  let core = await readCoreProperties(pkg);
  let workbookXml = (await pkg.readText('xl/workbook.xml')) ?? '';
  let names = sheetNames(workbookXml);
  let sharedStrings = readSharedStrings(
    await pkg.readText('xl/sharedStrings.xml'),
  );

  let firstPart = firstSheetPart(pkg);
  let sheetXml = firstPart ? await pkg.readText(firstPart) : undefined;
  let preview: GridPreview | undefined;
  if (sheetXml) {
    let grid = readSheetGrid(sheetXml, names[0] ?? 'Sheet1', sharedStrings);
    if (grid.rows.length) {
      preview = { sheets: [grid] };
    }
  }

  return pruneUndefined({
    ...core,
    kind: 'spreadsheet',
    sheetCount: names.length || undefined,
    sheetNames: names.length ? names : undefined,
    previewJson: preview ? JSON.stringify(preview) : undefined,
  }) as OfficeMetadata;
}
