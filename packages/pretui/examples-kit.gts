// Pretui — shared scaffolding for the per-component example galleries.
//
// The seeded word engine: realm code may not touch Math.random or Date.now,
// so every example's content derives from an FNV-1a hash of the component's
// own name. Same page, same words, every render — but each page draws
// different names, teas and amounts from the banks, so no gallery reads as
// boilerplate. The fiction is the tea trade the kit showcase inhabits.
//
// Extracted from examples.gts so per-component example modules can import it
// without a cycle through that barrel. `./examples` re-exports everything
// public here for the modules that already import it from there.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// ── The seeded word engine ───────────────────────────────────────────────

// FNV-1a — the page's name becomes its number. Stable across renders,
// sessions, and machines (Math.imul keeps the multiply in uint32 land).
export function seedFrom(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Deterministic pick: seed + slot index n → one entry. Each distinct pull
// on a page takes the next slot so one seed yields many different words.
export function pick<T>(seed: number, n: number, list: T[]): T {
  let x = (seed ^ (Math.imul(n + 1, 0x9e3779b1) >>> 0)) >>> 0;
  return list[x % list.length];
}

// Deterministic run of `count` DISTINCT entries (consecutive from a hashed
// start, wrapping) — for option lists and checklists where a duplicate
// would read as a bug.
export function take<T>(seed: number, n: number, count: number, list: T[]): T[] {
  let start = ((seed ^ (Math.imul(n + 1, 0x85ebca6b) >>> 0)) >>> 0) % list.length;
  let out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(list[(start + i) % list.length]);
  }
  return out;
}

export function slugOf(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── Word banks — the tea-trade fiction ───────────────────────────────────

export const PEOPLE = [
  'Mei-Lin Chua',
  'Tomás Aravena',
  'Ingrid Halvorsen',
  'Kwame Boateng',
  'Priya Raghunathan',
  'Yusuf Demirci',
  'Anaïs Fontaine',
  'Ryo Katagiri',
  'Zanele Mokoena',
  'Petra Novotná',
  'Diego Salcedo',
  'Leila Barzani',
];

export const SUPPLIERS = [
  'Wuyi Origins',
  'Silver Peak Trading',
  'Meiko Tea Export',
  'Cape Vanilla Co.',
  'Alishan Cloud Farms',
  'Junshan Estate Direct',
  'Nilgiri Leaf Cooperative',
  'Uji Valley Growers',
  'Fujian Maritime Tea',
  'Kericho Leaf Union',
  'Darjeeling First Flush Ltd.',
  'Highland Leaf Partners',
];

export const TEAS = [
  'Da Hong Pao',
  'Silver Needle',
  'Gyokuro',
  'Tieguanyin',
  'Junshan Yinzhen',
  'Milk Oolong',
  'Aged Shou Pu-erh',
  'Keemun Hao Ya',
  'Genmaicha',
  'White Peony',
  'Lapsang Souchong',
  'Jasmine Dragon Pearls',
];

export const PLACES = [
  'Wuyishan',
  'Uji',
  'Alishan',
  'Darjeeling',
  'Kericho',
  'Fuding',
  'Anxi',
  'Hangzhou',
  'Nuwara Eliya',
  'Yiwu',
  'Shizuoka',
  'Munnar',
];

export const TASKS = [
  'Confirm the spring booking',
  'Approve the cupping notes',
  'Re-price ceremonial lots',
  'Schedule the curing room',
  'Draft the restock order',
  'Chase the customs paperwork',
  'Update the harvest ledger',
  'Review supplier scorecards',
  'Tag the incoming batch',
  'Publish the seasonal menu',
  'Audit the humidity logs',
  'Close out batch B-1181',
];

export const AMOUNTS = [
  '$84/kg',
  '$95/kg',
  '$102/kg',
  '$78/kg',
  '¥1,240/kg',
  '11.2 kg',
  '48 crates',
  '620 tins',
  '$12,480',
  '3.4 t',
  '$5.60/tin',
  '96 kg',
];

export const DATES = [
  '2026-03-14',
  '2026-04-02',
  '2026-04-19',
  '2026-05-07',
  '2026-05-23',
  '2026-06-11',
  '2026-06-30',
  '2026-07-08',
  '2026-07-26',
  '2026-08-15',
  '2026-09-03',
  '2026-09-21',
];

// ── Shared example scaffolding (layout + the two text voices) ────────────

interface YieldDivSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}
interface YieldSpanSignature {
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

export const Row: TemplateOnlyComponent<YieldDivSignature> = <template>
  <div class='ex-row' ...attributes>{{yield}}</div>
  <style scoped>
    .ex-row {
      display: flex;
      align-items: center;
      gap: var(--space-3, 8px);
      flex-wrap: wrap;
      min-width: 0;
    }
  </style>
</template>;

export const Stack: TemplateOnlyComponent<YieldDivSignature> = <template>
  <div class='ex-stack' ...attributes>{{yield}}</div>
  <style scoped>
    .ex-stack {
      display: grid;
      gap: var(--space-3, 8px);
      align-content: start;
      justify-items: start;
      min-width: 0;
    }
  </style>
</template>;

// Sentence-case UI text beside a control (type spec: sans, no caps).
export const Lab: TemplateOnlyComponent<YieldSpanSignature> = <template>
  <span class='ex-lab' ...attributes>{{yield}}</span>
  <style scoped>
    .ex-lab {
      font-size: var(--text-ui-md, 12.5px);
      color: var(--foreground);
    }
  </style>
</template>;

// Machine values only (type spec: mono is reserved for them).
export const Mono: TemplateOnlyComponent<YieldSpanSignature> = <template>
  <span class='ex-mono' ...attributes>{{yield}}</span>
  <style scoped>
    .ex-mono {
      font-family: var(--font-mono);
      font-size: var(--text-ui-sm, 11.5px);
      color: var(--muted-foreground);
      font-variant-numeric: tabular-nums;
    }
  </style>
</template>;

// ── The gallery contract ─────────────────────────────────────────────────

export interface ExampleSpec {
  title: string;
  note?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any;
}
