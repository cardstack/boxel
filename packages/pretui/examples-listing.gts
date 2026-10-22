// Pretui — the tea-lot listing fixture shared by the DataTable, List, Item
// and Descriptions usage pages: twelve lots, deterministic through
// seedFrom/pick/take (no Math.random, no Date.now — the indexer needs the
// same bytes every time). It lives in its own module so that no usage page
// exports anything but its DEMOS_* registry.
import {
  AMOUNTS,
  PLACES,
  SUPPLIERS,
  TEAS,
  pick,
  seedFrom,
  take,
} from './examples';

export interface Lot {
  id: string;
  tea: string;
  supplier: string;
  place: string;
  grade: string;
  price: string;
  kg: number;
  note: string;
}

export const GRADES = ['Reserve', 'First flush', 'Standard'];
const SEED = seedFrom('pretui-reading-listing');
const TEA_RUN = take(SEED, 0, 12, TEAS);
const SUPPLIER_RUN = take(SEED, 1, 12, SUPPLIERS);
const PLACE_RUN = take(SEED, 2, 12, PLACES);

export const LOTS: Lot[] = TEA_RUN.map((tea, i) => ({
  id: 'B-' + String(1180 + i),
  tea,
  supplier: SUPPLIER_RUN[i] as string,
  place: PLACE_RUN[i] as string,
  grade: pick(SEED, i + 3, GRADES),
  price: pick(SEED, i + 7, AMOUNTS),
  kg: 24 + ((SEED >>> (i % 12)) % 76),
  note:
    'Cupped on arrival at the desk. Liquor bright, no astringency at the tail; the lot was split across two chests and the second reads a half-note sweeter.',
}));


export const MODES = ['none', 'single', 'multi'];
export const SIZES = ['xs', 's', 'm', 'l', 'xl'];

export function lotLabel(row: Lot): string {
  return row.tea + ' from ' + row.supplier;
}
