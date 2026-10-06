// Pretui — demo-surfaces-grid: the ledger fixture the Sheet and SheetToolbar usage pages share.
import { DATES, PLACES, SUPPLIERS, TEAS, pick, seedFrom } from './examples';
import type { SheetColumn } from './components/sheet';

// ── The fiction: a tea importer's arrivals ledger ────────────────────────
// Deterministic (seedFrom/pick — Realm law: no Math.random, no Date.now),
// and every row carries an `id`, because getSheet keys rows by `row.id`
// and falls back to the ordinal when it is missing — which makes the
// selected cell jump the moment a sort reorders the rows.
//
// A type ALIAS, not an interface: an interface has no implicit index
// signature, so `Lot[]` would not be assignable to `SheetDatum[]`.
export type Lot = {
  id: string;
  lot: string;
  tea: string;
  origin: string;
  supplier: string;
  kilos: number;
  price: number;
  arrives: string;
  cleared: boolean;
};

const LEDGER_SEED = seedFrom('pretui-arrivals-ledger');

function lotCode(origin: string, arrives: string, index: number): string {
  let place = origin.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
  let stamp = `${arrives.slice(2, 4)}${arrives.slice(5, 7)}`;
  return `${place}-${stamp}-${String.fromCharCode(65 + (index % 26))}`;
}

export function buildLedger(count: number): Lot[] {
  let out: Lot[] = [];
  for (let i = 0; i < count; i++) {
    let tea = pick(LEDGER_SEED, i, TEAS);
    let origin = pick(LEDGER_SEED, i + 31, PLACES);
    let supplier = pick(LEDGER_SEED, i + 67, SUPPLIERS);
    let arrives = pick(LEDGER_SEED, i + 101, DATES);
    let n = seedFrom(`${tea}/${origin}/${i}`);
    out.push({
      id: `lot-${i}`,
      lot: lotCode(origin, arrives, i),
      tea,
      origin,
      supplier,
      kilos: 18 + (n % 240),
      price: Number((36 + ((n >>> 9) % 310) + ((n >>> 5) % 100) / 100).toFixed(2)),
      arrives,
      cleared: (n >>> 3) % 3 !== 0,
    });
  }
  return out;
}

export const LEDGER_COLUMNS: SheetColumn[] = [
  {
    key: 'lot',
    label: 'Lot',
    type: 'text',
    width: 'minmax(8.5rem, 0.8fr)',
    // A reference the warehouse assigned — a machine value (Law 3), and
    // not ours to retype. Per-column gate, independent of @editable.
    mono: true,
    editable: false,
    hint: 'ref',
  },
  { key: 'tea', label: 'Tea', type: 'text', width: 'minmax(10rem, 1.4fr)' },
  { key: 'origin', label: 'Origin', type: 'text', width: 'minmax(8rem, 1fr)' },
  {
    key: 'supplier',
    label: 'Supplier',
    type: 'text',
    width: 'minmax(12rem, 1.6fr)',
  },
  {
    key: 'kilos',
    label: 'Weight',
    type: 'number',
    width: 'minmax(6rem, 0.6fr)',
    hint: 'kg',
  },
  {
    key: 'price',
    label: 'Price',
    type: 'number',
    width: 'minmax(7rem, 0.7fr)',
    hint: 'USD/kg',
  },
  {
    key: 'arrives',
    label: 'Arrives',
    type: 'date',
    width: 'minmax(8.5rem, 0.8fr)',
  },
  {
    key: 'cleared',
    label: 'Cleared',
    type: 'boolean',
    width: 'minmax(6rem, 0.5fr)',
    sortable: false,
  },
];

