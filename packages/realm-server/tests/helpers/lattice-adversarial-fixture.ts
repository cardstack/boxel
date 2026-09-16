import {
  rri,
  type Definition,
  type FieldDefinition,
  type LooseSingleCardDocument,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

// An adversarial workload for Lattice. Where the clinical fixture proves the
// happy path of a realistic dashboard, this one is built to hurt: deep owner
// chains, oversized inputs, truncated queries, formulas that fail or run hot,
// feeders that flap, fan-out to hundreds of owners, cycles among owners, and
// links that point off the realm. "Performs as expected" here rarely means
// "publishes a value"; it means the system converges when it can, withholds
// with a reason when it cannot, never publishes a partial or wrong value, and
// never lets one bad owner take its neighbours down. Four layers consume it:
//
//   lattice-adversarial-bxl-test          pure BXL execution, no database
//   lattice-adversarial-routing-test      Postgres registry, no browser
//   lattice-adversarial-publication-test  full realm, Chrome producer
//   docs/lattice-adversarial-use-cases.md the catalog and its findings
//
// Every value is fabricated. The oracle mirrors the formulas in plain
// TypeScript so a layer can say what a correct publication would contain.

// ---------------------------------------------------------------------------
// Card sources. The healthy module is generated so the owner chain depth is a
// knob. The unhealthy module is a separate file so its failures cannot poison
// the healthy definitions: a module that fails to load fails every class in it.

export interface AdversarialSourceOptions {
  // Number of materialized tiers stacked on the leaves. Tier k queries tier
  // k-1; tier 1 queries the leaves.
  depth: number;
}

const HEADER = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, Component, field, contains, containsMany, linksTo, linksToMany } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import NumberField from '@cardstack/base/number';
  import BooleanField from '@cardstack/base/boolean';
  const formula = (expression) => bxl(expression, { libraries: ['core'], readableSyntax: false });
`;

const FLAPPER = `
  export class Flapper extends CardDef {
    @field group = contains(StringField);
    @field on = contains(BooleanField);
    @field n = contains(NumberField);
    @field cardTitle = contains(StringField, { computeVia: formula('.group + " " + (.n | tostring)') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}</output></template>
    };
  }
`;

// The write-path regression uses the same definition without loading all the
// unrelated failing, remote and deep-query owners from the stress module.
export const adversarialFlapperSource = HEADER + FLAPPER;

function tierClass(k: number): string {
  const below = k === 1 ? 'Leaf' : `Tier${k - 1}`;
  return `
  export class Tier${k} extends CardDef {
    static materialized = true;
    static queryInputs = { below: {} };
    @field chain = contains(StringField);
    @field below = linksToMany(${below}, {
      query: { filter: { eq: { chain: '$this.chain' } }, page: { size: 50 } },
    });
    @field total = contains(NumberField, { computeVia: formula('[.below[].total] | add // 0') });
    @field depth = contains(NumberField, { computeVia: formula('${k}') });
    @field cardTitle = contains(StringField, { computeVia: formula('"tier ${k} " + .chain') });
    static isolated = class extends Component<typeof this> {
      <template><output data-total>{{@model.total}}</output></template>
    };
  }`;
}

export function adversarialSource({ depth }: AdversarialSourceOptions): string {
  if (!Number.isInteger(depth) || depth < 1 || depth > 24)
    throw new Error('Adversarial depth must be an integer between 1 and 24');
  const tiers = Array.from({ length: depth }, (_, i) => tierClass(i + 1)).join(
    '\n',
  );
  return `${HEADER}
  export class Leaf extends CardDef {
    @field chain = contains(StringField);
    @field label = contains(StringField);
    @field value = contains(NumberField);
    @field total = contains(NumberField, { computeVia: formula('.value // 0') });
    // \`label\` is a BXL keyword: \`.label\` fails to parse, so the field is read by name.
    @field cardTitle = contains(StringField, { computeVia: formula('.["label"] // .chain') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}</output></template>
    };
  }
  ${tiers}

  export class Entry extends CardDef {
    @field bucket = contains(StringField);
    @field n = contains(NumberField);
    @field text = contains(StringField);
    @field cardTitle = contains(StringField, { computeVia: formula('.bucket + " " + (.n | tostring)') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}</output></template>
    };
  }

  export class BucketCount extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field count = contains(NumberField, { computeVia: formula('.entries | length') });
    @field sum = contains(NumberField, { computeVia: formula('[.entries[].n] | add // 0') });
    @field cardTitle = contains(StringField, { computeVia: formula('"count " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output data-count>{{@model.count}}</output></template>
    };
  }

  export class Stats extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 500 } },
    });
    @field mean = contains(NumberField, { computeVia: formula('([.entries[].n] | add // 0) / (([.entries[].n] | length) | if . == 0 then 1 else . end)') });
    @field variance = contains(NumberField, {
      computeVia: formula('[.entries[].n] as $xs | ($xs | length) as $k | if $k == 0 then 0 else (($xs | map(. * .) | add) / $k) - ((($xs | add) / $k) * (($xs | add) / $k)) end'),
    });
    @field p90 = contains(NumberField, {
      computeVia: formula('[.entries[].n] | sort as $s | ($s | length) as $k | if $k == 0 then 0 else $s[(($k * 9 / 10) | floor) | if . >= $k then $k - 1 else . end] end'),
    });
    @field distinctTexts = contains(NumberField, { computeVia: formula('[.entries[].text] | unique | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"stats " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output data-mean>{{@model.mean}}</output></template>
    };
  }

  export class Bulk extends CardDef {
    @field chain = contains(StringField);
    @field blob = contains(StringField);
    @field cardTitle = contains(StringField, { computeVia: formula('"bulk " + .chain') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}</output></template>
    };
  }

  export class BulkRollup extends CardDef {
    static materialized = true;
    static queryInputs = { bulks: {} };
    @field chain = contains(StringField);
    @field bulks = linksToMany(Bulk, {
      query: { filter: { eq: { chain: '$this.chain' } }, page: { size: 10 } },
    });
    @field blobChars = contains(NumberField, { computeVia: formula('[.bulks[].blob | length] | add // 0') });
    @field cardTitle = contains(StringField, { computeVia: formula('"rollup " + .chain') });
    static isolated = class extends Component<typeof this> {
      <template><output data-chars>{{@model.blobChars}}</output></template>
    };
  }

  ${FLAPPER}

  export class GroupOn extends CardDef {
    static materialized = true;
    static queryInputs = { flappers: {} };
    @field group = contains(StringField);
    @field flappers = linksToMany(Flapper, {
      query: { filter: { eq: { group: '$this.group', on: true } }, page: { size: 50 } },
    });
    @field onCount = contains(NumberField, { computeVia: formula('.flappers | length') });
    @field onSum = contains(NumberField, { computeVia: formula('[.flappers[].n] | add // 0') });
    @field cardTitle = contains(StringField, { computeVia: formula('"on " + .group') });
    static isolated = class extends Component<typeof this> {
      <template><output data-on>{{@model.onCount}}</output></template>
    };
  }

  export class Notice extends CardDef {
    @field audience = contains(StringField);
    @field body = contains(StringField);
    @field cardTitle = contains(StringField, { computeVia: formula('.audience + ": " + .body') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}</output></template>
    };
  }

  export class Subscriber extends CardDef {
    static materialized = true;
    static queryInputs = { notices: {} };
    @field audience = contains(StringField);
    @field seat = contains(NumberField);
    @field notices = linksToMany(Notice, {
      query: { filter: { eq: { audience: '$this.audience' } }, page: { size: 50 } },
    });
    @field noticeCount = contains(NumberField, { computeVia: formula('.notices | length') });
    @field latestBody = contains(StringField, { computeVia: formula('([.notices[].body] | max) // ""') });
    @field cardTitle = contains(StringField, { computeVia: formula('"seat " + (.seat | tostring)') });
    static isolated = class extends Component<typeof this> {
      <template><output data-notices>{{@model.noticeCount}}</output></template>
    };
  }

  export class Slow extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field count = contains(NumberField, { computeVia: formula('.entries | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"slow " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output data-count>{{@model.count}}</output></template>
    };
  }

  export class JsOwner extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field doubled = contains(NumberField, {
      computeVia: function () { return (this.entries ?? []).filter(Boolean).length * 2; },
    });
    @field cardTitle = contains(StringField, { computeVia: formula('"js " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output data-doubled>{{@model.doubled}}</output></template>
    };
  }

  export class Remote extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field partner = linksTo(Leaf);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field partnerLabel = contains(StringField, { computeVia: formula('.partner["label"] // "blank"') });
    @field count = contains(NumberField, { computeVia: formula('.entries | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"remote " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output data-partner>{{@model.partnerLabel}}</output></template>
    };
  }

  export class CycleA extends CardDef {
    static materialized = true;
    static queryInputs = { sideB: {} };
    @field chain = contains(StringField);
    @field sideB = linksToMany(() => CycleB, {
      query: { filter: { eq: { chain: '$this.chain' } }, page: { size: 10 } },
    });
    @field count = contains(NumberField, { computeVia: formula('.sideB | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"cycle a " + .chain') });
    static isolated = class extends Component<typeof this> {
      <template><output data-count>{{@model.count}}</output></template>
    };
  }

  export class CycleB extends CardDef {
    static materialized = true;
    static queryInputs = { sideA: {} };
    @field chain = contains(StringField);
    @field sideA = linksToMany(() => CycleA, {
      query: { filter: { eq: { chain: '$this.chain' } }, page: { size: 10 } },
    });
    @field count = contains(NumberField, { computeVia: formula('.sideA | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"cycle b " + .chain') });
    static isolated = class extends Component<typeof this> {
      <template><output data-count>{{@model.count}}</output></template>
    };
  }

  export class Weird extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field none = contains(NumberField, { computeVia: formula('null') });
    @field big = contains(NumberField, { computeVia: formula('9007199254740993') });
    @field joined = contains(StringField, { computeVia: formula('[.entries[].text] | sort | join("|")') });
    @field count = contains(NumberField, { computeVia: formula('.entries | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"weird " + .bucket') });
    get explode() { throw new Error('the template asked for a getter that throws'); }
    static isolated = class extends Component<typeof this> {
      <template><output data-count>{{@model.count}}</output><output>{{@model.explode}}</output></template>
    };
  }

  export class Constant extends CardDef {
    static materialized = true;
    static queryInputs = {};
    @field bucket = contains(StringField);
    @field answer = contains(NumberField, { computeVia: formula('42') });
    @field cardTitle = contains(StringField, { computeVia: formula('"constant " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output data-answer>{{@model.answer}}</output></template>
    };
  }
`;
}

// Formulas that are wrong in four different ways. Each owner queries the same
// entries as BucketCount, so a healthy sibling proves the blast radius of a
// bad formula is one owner.
export const adversarialBadSource = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, Component, field, contains, linksToMany } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import NumberField from '@cardstack/base/number';
  import { Entry } from './cards';
  const formula = (expression) => bxl(expression, { libraries: ['core'], readableSyntax: false });

  export class BadRuntime extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field ratio = contains(NumberField, { computeVia: formula('(.entries | length) / ((.entries | length) - (.entries | length))') });
    @field cardTitle = contains(StringField, { computeVia: formula('"bad runtime " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.ratio}}</output></template>
    };
  }

  export class BadType extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field mixed = contains(NumberField, { computeVia: formula('.bucket + 1') });
    @field cardTitle = contains(StringField, { computeVia: formula('"bad type " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.mixed}}</output></template>
    };
  }

  export class BadNull extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field iterated = contains(NumberField, { computeVia: formula('[.missing[]] | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('"bad null " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.iterated}}</output></template>
    };
  }

  export class BadShape extends CardDef {
    static materialized = true;
    static queryInputs = { entries: {} };
    @field bucket = contains(StringField);
    @field entries = linksToMany(Entry, {
      query: { filter: { eq: { bucket: '$this.bucket' } }, page: { size: 50 } },
    });
    @field object = contains(NumberField, { computeVia: formula('{ a: (.entries | length) }') });
    @field cardTitle = contains(StringField, { computeVia: formula('"bad shape " + .bucket') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.object}}</output></template>
    };
  }
`;

// A module whose top level throws. Every class in it is unloadable; owners
// adopting from it must be refused with a reason, and nothing else may care.
export const adversarialBrokenSource = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, Component, field, contains } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  const formula = (expression) => bxl(expression, { libraries: ['core'], readableSyntax: false });
  const broken = formula('.count | | foo');
  export class BrokenModule extends CardDef {
    static materialized = true;
    static queryInputs = {};
    @field bucket = contains(StringField);
    @field value = contains(StringField, { computeVia: broken });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.value}}</output></template>
    };
  }
`;

// ---------------------------------------------------------------------------
// Records.

export type AdversarialType =
  | 'Leaf'
  | 'Entry'
  | 'Bulk'
  | 'Flapper'
  | 'Notice'
  | 'BucketCount'
  | 'Stats'
  | 'BulkRollup'
  | 'GroupOn'
  | 'Subscriber'
  | 'Slow'
  | 'JsOwner'
  | 'Remote'
  | 'CycleA'
  | 'CycleB'
  | 'Weird'
  | 'Constant'
  | 'BadRuntime'
  | 'BadType'
  | 'BadNull'
  | 'BadShape'
  | 'BrokenModule'
  | `Tier${number}`;

export const BAD_TYPES: AdversarialType[] = [
  'BadRuntime',
  'BadType',
  'BadNull',
  'BadShape',
];

export interface AdversarialDocument {
  data: {
    type: 'card';
    attributes: Record<string, unknown>;
    relationships?: Record<string, { links: { self: string | null } }>;
    meta: { adoptsFrom: ResolvedCodeRef };
  };
}
export type AdversarialRecords = Map<string, AdversarialDocument>;

export function adversarialModuleRef(
  realmURL: string,
  name: AdversarialType,
): ResolvedCodeRef {
  const module = BAD_TYPES.includes(name)
    ? 'bad'
    : name === 'BrokenModule'
      ? 'broken'
      : 'cards';
  return { module: rri(realmURL + module), name };
}

export function adversarialTypeOf(
  records: AdversarialRecords,
  path: string,
): AdversarialType {
  return records.get(path)!.data.meta.adoptsFrom.name as AdversarialType;
}

export function isOwnerType(name: AdversarialType): boolean {
  return !['Leaf', 'Entry', 'Bulk', 'Flapper', 'Notice'].includes(name);
}

export interface GenerateAdversarialOptions {
  realmURL: string;
  seed?: number;
  // Owner chain depth (tiers above the leaves).
  depth?: number;
  // Chains, each with its own leaf set and one owner per tier.
  chains?: number;
  leavesPerChain?: number;
  // Entries in the "many" bucket; the counting owner's page is 50, so more
  // than 50 truncates.
  manyEntries?: number;
  // Entries in the "stats" bucket, all under the 500 page.
  statsEntries?: number;
  // Fan-out: subscribers to one audience.
  subscribers?: number;
  // Flappers in one group.
  flappers?: number;
  // Bulk blob size in characters, and how many bulks share the chain. The
  // native input limit is 1 MiB per card and 4 MiB per batch.
  bulkChars?: number;
  bulks?: number;
  // The URL the Remote owner's partner points at. Default: a card on another
  // realm of the same origin that does not exist.
  remotePartner?: string;
}

export interface AdversarialIds {
  chains: string[];
  leaves: Record<string, string[]>;
  tiers: Record<string, string[]>; // chain -> [tier1 path, tier2 path, ...]
  manyBucket: string;
  manyEntries: string[];
  statsBucket: string;
  statsEntries: string[];
  smallBucket: string;
  smallEntries: string[];
  bucketCount: Record<string, string>;
  stats: string;
  bulkChain: string;
  bulkCards: string[];
  bulkRollup: string;
  group: string;
  flapperCards: string[];
  groupOn: string;
  audience: string;
  notices: string[];
  subscribers: string[];
  slow: string;
  jsOwner: string;
  remote: string;
  cycleA: string;
  cycleB: string;
  weird: string;
  constant: string;
  bad: Record<string, string>;
  brokenModule: string;
  poisonEntry?: string;
}

function pad(n: number): string {
  return String(n).padStart(5, '0');
}

export function generateAdversarial(options: GenerateAdversarialOptions): {
  records: AdversarialRecords;
  ids: AdversarialIds;
  depth: number;
} {
  const {
    realmURL,
    seed = 4242,
    depth = 4,
    chains = 2,
    leavesPerChain = 3,
    manyEntries = 60,
    statsEntries = 120,
    subscribers = 40,
    flappers = 6,
    bulkChars = 64 * 1024,
    bulks = 3,
    remotePartner = 'other-realm/Leaf/missing',
  } = options;
  for (const [name, value, low, high] of [
    ['depth', depth, 1, 24],
    ['chains', chains, 1, 50],
    ['leavesPerChain', leavesPerChain, 1, 50],
    ['manyEntries', manyEntries, 0, 5000],
    ['statsEntries', statsEntries, 0, 500],
    ['subscribers', subscribers, 1, 2000],
    ['flappers', flappers, 1, 50],
    ['bulkChars', bulkChars, 1, 4 * 1024 * 1024],
    ['bulks', bulks, 1, 10],
  ] as const)
    if (!Number.isInteger(value) || value < low || value > high)
      throw new Error(
        `Adversarial ${name} must be an integer between ${low} and ${high}`,
      );
  let state = seed >>> 0;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const between = (low: number, high: number) =>
    low + Math.floor(random() * (high - low + 1));
  const records: AdversarialRecords = new Map();
  const put = (
    path: string,
    name: AdversarialType,
    attributes: Record<string, unknown>,
    relationships?: AdversarialDocument['data']['relationships'],
  ) => {
    records.set(path + '.json', {
      data: {
        type: 'card',
        attributes,
        ...(relationships ? { relationships } : {}),
        meta: { adoptsFrom: adversarialModuleRef(realmURL, name) },
      },
    });
    return path + '.json';
  };

  // Deep chains. Tier directories sort in height order (T01 < T02 …) so the
  // drain's URL-ordered pick does not deadlock the boot; the drain-order
  // reproducer lives in the clinical catalog.
  const ids: AdversarialIds = {
    chains: [],
    leaves: {},
    tiers: {},
    manyBucket: 'many',
    manyEntries: [],
    statsBucket: 'stats',
    statsEntries: [],
    smallBucket: 'small',
    smallEntries: [],
    bucketCount: {},
    stats: '',
    bulkChain: 'bulk',
    bulkCards: [],
    bulkRollup: '',
    group: 'flap',
    flapperCards: [],
    groupOn: '',
    audience: 'everyone',
    notices: [],
    subscribers: [],
    slow: '',
    jsOwner: '',
    remote: '',
    cycleA: '',
    cycleB: '',
    weird: '',
    constant: '',
    bad: {},
    brokenModule: '',
  };
  for (let c = 1; c <= chains; c++) {
    const chain = `chain-${pad(c)}`;
    ids.chains.push(chain);
    ids.leaves[chain] = [];
    ids.tiers[chain] = [];
    for (let l = 1; l <= leavesPerChain; l++)
      ids.leaves[chain].push(
        put(`Leaf/${chain}-${pad(l)}`, 'Leaf', {
          chain,
          label: `leaf ${c}.${l}`,
          value: between(1, 100),
        }),
      );
    for (let k = 1; k <= depth; k++)
      ids.tiers[chain].push(put(`T${pad(k)}/${chain}`, `Tier${k}`, { chain }));
  }

  // Buckets of entries.
  const entry = (bucket: string, i: number) =>
    put(`Entry/${bucket}-${pad(i)}`, 'Entry', {
      bucket,
      n: between(0, 1000),
      text: `${bucket} text ${i % 7}`,
    });
  for (let i = 1; i <= manyEntries; i++)
    ids.manyEntries.push(entry(ids.manyBucket, i));
  for (let i = 1; i <= statsEntries; i++)
    ids.statsEntries.push(entry(ids.statsBucket, i));
  for (let i = 1; i <= 4; i++) ids.smallEntries.push(entry(ids.smallBucket, i));
  for (const bucket of [ids.manyBucket, ids.statsBucket, ids.smallBucket])
    ids.bucketCount[bucket] = put(
      `${bucket === ids.manyBucket ? 'Zy' : 'Own'}/count-${bucket}`,
      'BucketCount',
      { bucket },
    );
  ids.stats = put(`Own/stats`, 'Stats', { bucket: ids.statsBucket });

  // Bulk data.
  const blob = (i: number) => {
    const unit = `bulk-${i}-`;
    return unit.repeat(Math.ceil(bulkChars / unit.length)).slice(0, bulkChars);
  };
  for (let i = 1; i <= bulks; i++)
    ids.bulkCards.push(
      put(`Bulk/${ids.bulkChain}-${pad(i)}`, 'Bulk', {
        chain: ids.bulkChain,
        blob: blob(i),
      }),
    );
  ids.bulkRollup = put(`Own/rollup-${ids.bulkChain}`, 'BulkRollup', {
    chain: ids.bulkChain,
  });

  // Flappers: half on.
  for (let i = 1; i <= flappers; i++)
    ids.flapperCards.push(
      put(`Flapper/${ids.group}-${pad(i)}`, 'Flapper', {
        group: ids.group,
        on: i % 2 === 0,
        n: between(1, 9),
      }),
    );
  ids.groupOn = put(`Own/on-${ids.group}`, 'GroupOn', { group: ids.group });

  // Fan-out.
  ids.notices.push(
    put(`Notice/n-00001`, 'Notice', {
      audience: ids.audience,
      body: 'welcome',
    }),
  );
  for (let s = 1; s <= subscribers; s++)
    ids.subscribers.push(
      put(`Own/seat-${pad(s)}`, 'Subscriber', {
        audience: ids.audience,
        seat: s,
      }),
    );

  // Singletons over the small bucket.
  ids.slow = put(`Own/slow`, 'Slow', { bucket: ids.smallBucket });
  ids.jsOwner = put(`Own/js`, 'JsOwner', { bucket: ids.smallBucket });
  ids.remote = put(
    `Zz/remote`,
    'Remote',
    { bucket: ids.smallBucket },
    { partner: { links: { self: '../' + remotePartner } } },
  );
  ids.cycleA = put(`Zz/cycle-a`, 'CycleA', { chain: 'cyc' });
  ids.cycleB = put(`Zz/cycle-b`, 'CycleB', { chain: 'cyc' });
  ids.weird = put(`Zz/weird`, 'Weird', { bucket: ids.smallBucket });
  ids.constant = put(`Own/constant`, 'Constant', { bucket: 'none' });
  for (const name of BAD_TYPES)
    ids.bad[name] = put(`Zz/${name.toLowerCase()}`, name, {
      bucket: ids.smallBucket,
    });
  ids.brokenModule = put(`Zz/broken-module`, 'BrokenModule', {
    bucket: ids.smallBucket,
  });
  return { records, ids, depth };
}

export function adversarialFixtures(
  records: AdversarialRecords,
): Record<string, LooseSingleCardDocument> {
  return Object.fromEntries(
    [...records].map(([path, doc]) => [
      path,
      doc as unknown as LooseSingleCardDocument,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Oracle: what a correct publication of each owner would contain. Owners that
// must never publish a ready value return `undefined`.

type Attrs = Record<string, unknown>;

function attrs(doc: AdversarialDocument): Attrs {
  return doc.data.attributes;
}

function ofType(records: AdversarialRecords, type: AdversarialType) {
  return [...records].filter(
    ([, doc]) => doc.data.meta.adoptsFrom.name === type,
  );
}

function jqAdd(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function expectedLeafTotal(doc: AdversarialDocument): number {
  const value = attrs(doc).value;
  return typeof value === 'number' ? value : 0;
}

export function expectedTier(records: AdversarialRecords, path: string): Attrs {
  const doc = records.get(path)!;
  const k = Number(String(doc.data.meta.adoptsFrom.name).slice(4));
  const chain = attrs(doc).chain;
  const below =
    k === 1
      ? ofType(records, 'Leaf')
          .filter(([, leaf]) => attrs(leaf).chain === chain)
          .map(([, leaf]) => expectedLeafTotal(leaf))
      : ofType(records, `Tier${k - 1}`)
          .filter(([, tier]) => attrs(tier).chain === chain)
          .map(([tierPath]) => expectedTier(records, tierPath).total as number);
  return { total: jqAdd(below), depth: k };
}

function bucketEntries(records: AdversarialRecords, bucket: unknown) {
  return ofType(records, 'Entry')
    .filter(([, entry]) => attrs(entry).bucket === bucket)
    .map(([, entry]) => attrs(entry));
}

export function expectedBucketCount(
  records: AdversarialRecords,
  path: string,
): Attrs {
  const entries = bucketEntries(records, attrs(records.get(path)!).bucket);
  return {
    count: entries.length,
    sum: jqAdd(entries.map((e) => e.n as number)),
  };
}

export function expectedStats(
  records: AdversarialRecords,
  path: string,
): Attrs {
  const entries = bucketEntries(records, attrs(records.get(path)!).bucket);
  const xs = entries.map((e) => e.n as number);
  const k = xs.length;
  const sum = jqAdd(xs);
  const mean = sum / (k === 0 ? 1 : k);
  const variance =
    k === 0 ? 0 : jqAdd(xs.map((x) => x * x)) / k - (sum / k) * (sum / k);
  const sorted = [...xs].sort((a, b) => a - b);
  let idx = Math.floor((k * 9) / 10);
  if (idx >= k) idx = k - 1;
  const p90 = k === 0 ? 0 : sorted[idx];
  const distinctTexts = new Set(entries.map((e) => e.text)).size;
  return { mean, variance, p90, distinctTexts };
}

export function expectedBulkRollup(
  records: AdversarialRecords,
  path: string,
): Attrs {
  const chain = attrs(records.get(path)!).chain;
  const chars = ofType(records, 'Bulk')
    .filter(([, bulk]) => attrs(bulk).chain === chain)
    .map(([, bulk]) => String(attrs(bulk).blob).length);
  return { blobChars: jqAdd(chars) };
}

export function expectedGroupOn(
  records: AdversarialRecords,
  path: string,
): Attrs {
  const group = attrs(records.get(path)!).group;
  const on = ofType(records, 'Flapper')
    .filter(
      ([, flapper]) =>
        attrs(flapper).group === group && attrs(flapper).on === true,
    )
    .map(([, flapper]) => attrs(flapper).n as number);
  return { onCount: on.length, onSum: jqAdd(on) };
}

export function expectedSubscriber(
  records: AdversarialRecords,
  path: string,
): Attrs {
  const audience = attrs(records.get(path)!).audience;
  const bodies = ofType(records, 'Notice')
    .filter(([, notice]) => attrs(notice).audience === audience)
    .map(([, notice]) => String(attrs(notice).body));
  return {
    noticeCount: bodies.length,
    latestBody: bodies.length ? [...bodies].sort().at(-1) : '',
  };
}

export function expectedWeird(
  records: AdversarialRecords,
  path: string,
): Attrs {
  const entries = bucketEntries(records, attrs(records.get(path)!).bucket);
  return {
    none: null,
    big: 9007199254740992,
    joined: entries
      .map((e) => String(e.text))
      .sort()
      .join('|'),
    count: entries.length,
  };
}

export function expectedOwner(
  records: AdversarialRecords,
  path: string,
): Attrs | undefined {
  const type = adversarialTypeOf(records, path);
  if (type.startsWith('Tier')) return expectedTier(records, path);
  switch (type) {
    case 'BucketCount':
      return expectedBucketCount(records, path);
    case 'Stats':
      return expectedStats(records, path);
    case 'BulkRollup':
      return expectedBulkRollup(records, path);
    case 'GroupOn':
      return expectedGroupOn(records, path);
    case 'Subscriber':
      return expectedSubscriber(records, path);
    case 'Slow':
      return { count: expectedBucketCount(records, path).count };
    case 'JsOwner':
      return {
        doubled: (expectedBucketCount(records, path).count as number) * 2,
      };
    case 'Remote':
      return {
        partnerLabel: 'blank',
        count: expectedBucketCount(records, path).count,
      };
    case 'CycleA':
      return {
        count: ofType(records, 'CycleB').filter(
          ([, b]) => attrs(b).chain === attrs(records.get(path)!).chain,
        ).length,
      };
    case 'CycleB':
      return {
        count: ofType(records, 'CycleA').filter(
          ([, a]) => attrs(a).chain === attrs(records.get(path)!).chain,
        ).length,
      };
    case 'Weird':
      return expectedWeird(records, path);
    case 'Constant':
      return { answer: 42 };
    default:
      // Bad formulas and the broken module have no correct publication.
      return undefined;
  }
}

export function owners(records: AdversarialRecords): string[] {
  return [...records.keys()].filter((path) =>
    isOwnerType(adversarialTypeOf(records, path)),
  );
}

// ---------------------------------------------------------------------------
// Registry-layer definitions, watches and search documents for the subset the
// routing layer exercises: Notice/Subscriber (fan-out), Entry/BucketCount
// (many entries and inefficient filters), Leaf/Tier (depth), CycleA/CycleB.

export function adversarialDefinitions(
  realmURL: string,
  depth: number,
): Map<string, Definition> {
  const ref = (name: AdversarialType) => adversarialModuleRef(realmURL, name);
  const primitive = (
    scalar: 'string' | 'number' | 'boolean',
  ): FieldDefinition => ({
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: { module: rri(realmURL + 'primitives'), name: scalar },
    nativeCodec:
      scalar === 'number'
        ? { kind: 'primitive', serializer: 'number' }
        : scalar === 'string'
          ? { kind: 'primitive', scalar: 'string' }
          : { kind: 'primitive' },
    ...(scalar === 'number' ? { serializerName: 'number' } : {}),
  });
  const linksToMany = (
    name: AdversarialType,
    query?: Query,
  ): FieldDefinition => ({
    type: 'linksToMany',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: ref(name),
    nativeCodec: { kind: 'compound', resourceType: 'card' },
    ...(query ? { query } : {}),
  });
  const definition = (
    name: AdversarialType,
    fieldDefs: Definition['fieldDefs'],
    materialized = false,
  ): Definition => ({
    type: 'card-def',
    codeRef: ref(name),
    displayName: name,
    fields: Object.fromEntries(Object.keys(fieldDefs).map((f) => [f, f])),
    fieldDefs,
    nativeCodec: { kind: 'compound', resourceType: 'card' },
    ...(materialized
      ? {
          nativeIndex: {
            types: [ref(name)],
            displayNames: [name],
            cardType: name,
            materialized: true,
          },
        }
      : {}),
  });
  const s = primitive('string'),
    n = primitive('number'),
    b = primitive('boolean');
  const c = (base: FieldDefinition): FieldDefinition => ({
    ...base,
    isComputed: true,
  });
  const map = new Map<string, Definition>([
    ['Leaf', definition('Leaf', { chain: s, label: s, value: n, total: c(n) })],
    ['Entry', definition('Entry', { bucket: s, n, text: s })],
    ['Flapper', definition('Flapper', { group: s, on: b, n })],
    ['Notice', definition('Notice', { audience: s, body: s })],
    [
      'BucketCount',
      definition(
        'BucketCount',
        { bucket: s, entries: linksToMany('Entry'), count: c(n), sum: c(n) },
        true,
      ),
    ],
    [
      'GroupOn',
      definition(
        'GroupOn',
        {
          group: s,
          flappers: linksToMany('Flapper'),
          onCount: c(n),
          onSum: c(n),
        },
        true,
      ),
    ],
    [
      'Subscriber',
      definition(
        'Subscriber',
        {
          audience: s,
          seat: n,
          notices: linksToMany('Notice'),
          noticeCount: c(n),
          latestBody: c(s),
        },
        true,
      ),
    ],
    [
      'CycleA',
      definition(
        'CycleA',
        { chain: s, sideB: linksToMany('CycleB'), count: c(n) },
        true,
      ),
    ],
    [
      'CycleB',
      definition(
        'CycleB',
        { chain: s, sideA: linksToMany('CycleA'), count: c(n) },
        true,
      ),
    ],
  ]);
  for (let k = 1; k <= depth; k++)
    map.set(
      `Tier${k}`,
      definition(
        `Tier${k}`,
        {
          chain: s,
          below: linksToMany(k === 1 ? 'Leaf' : `Tier${k - 1}`),
          total: c(n),
          depth: c(n),
        },
        true,
      ),
    );
  return map;
}

export function adversarialWatches(
  realmURL: string,
  records: AdversarialRecords,
  ownerPath: string,
): Array<{ fieldPath: string; query: Query }> {
  const ref = (name: AdversarialType) => adversarialModuleRef(realmURL, name);
  const doc = records.get(ownerPath)!;
  const own = attrs(doc) as Record<string, string>;
  const type = adversarialTypeOf(records, ownerPath);
  if (type.startsWith('Tier')) {
    const k = Number(type.slice(4));
    return [
      {
        fieldPath: 'below',
        query: {
          filter: {
            on: ref(k === 1 ? 'Leaf' : `Tier${k - 1}`),
            eq: { chain: own.chain },
          },
          page: { size: 50 },
        },
      },
    ];
  }
  switch (type) {
    case 'BucketCount':
      return [
        {
          fieldPath: 'entries',
          query: {
            filter: { on: ref('Entry'), eq: { bucket: own.bucket } },
            page: { size: 50 },
          },
        },
      ];
    case 'GroupOn':
      return [
        {
          fieldPath: 'flappers',
          query: {
            filter: { on: ref('Flapper'), eq: { group: own.group, on: true } },
            page: { size: 50 },
          },
        },
      ];
    case 'Subscriber':
      return [
        {
          fieldPath: 'notices',
          query: {
            filter: { on: ref('Notice'), eq: { audience: own.audience } },
            page: { size: 50 },
          },
        },
      ];
    case 'CycleA':
      return [
        {
          fieldPath: 'sideB',
          query: {
            filter: { on: ref('CycleB'), eq: { chain: own.chain } },
            page: { size: 10 },
          },
        },
      ];
    case 'CycleB':
      return [
        {
          fieldPath: 'sideA',
          query: {
            filter: { on: ref('CycleA'), eq: { chain: own.chain } },
            page: { size: 10 },
          },
        },
      ];
    default:
      throw new Error(`${ownerPath} has no routing-layer watches`);
  }
}

export function adversarialSearchDoc(
  realmURL: string,
  records: AdversarialRecords,
  path: string,
): Record<string, unknown> {
  const doc = records.get(path)!;
  const searchDoc: Record<string, unknown> = {
    id: realmURL + path.replace(/\.json$/, ''),
    ...attrs(doc),
    ...(expectedOwner(records, path) ?? {}),
  };
  if (adversarialTypeOf(records, path) === 'Leaf')
    searchDoc.total = expectedLeafTotal(doc);
  for (const [name, value] of Object.entries(doc.data.relationships ?? {})) {
    if (!value.links.self) continue;
    searchDoc[name] = {
      id: realmURL + value.links.self.replace(/^\.\.\//, ''),
    };
  }
  return searchDoc;
}

// ---------------------------------------------------------------------------
// Writes and scenarios for the publication layer.

export interface AdversarialWrite {
  op: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  document?: AdversarialDocument;
  attributes?: Attrs;
  relationships?: AdversarialDocument['data']['relationships'];
}

export function applyAdversarialWrites(
  records: AdversarialRecords,
  writes: AdversarialWrite[],
): AdversarialRecords {
  const next: AdversarialRecords = new Map(
    [...records].map(([path, doc]) => [path, structuredClone(doc)]),
  );
  for (const write of writes) {
    switch (write.op) {
      case 'POST':
        if (!write.document)
          throw new Error(`POST ${write.path} needs a document`);
        next.set(write.path, structuredClone(write.document));
        break;
      case 'PATCH': {
        const doc = next.get(write.path);
        if (!doc) throw new Error(`PATCH ${write.path} does not exist`);
        Object.assign(doc.data.attributes, write.attributes ?? {});
        if (write.relationships)
          doc.data.relationships = {
            ...doc.data.relationships,
            ...write.relationships,
          };
        break;
      }
      case 'DELETE':
        if (!next.delete(write.path))
          throw new Error(`DELETE ${write.path} does not exist`);
        break;
    }
  }
  return next;
}

export function newEntry(
  realmURL: string,
  bucket: string,
  index: number,
  n: number,
  text = `${bucket} text ${index % 7}`,
): AdversarialWrite {
  return {
    op: 'POST',
    path: `Entry/${bucket}-${pad(index)}.json`,
    document: {
      data: {
        type: 'card',
        attributes: { bucket, n, text },
        meta: { adoptsFrom: adversarialModuleRef(realmURL, 'Entry') },
      },
    },
  };
}
