import {
  CardDef,
  Component,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import TextAreaField from '@cardstack/base/text-area';
import { identifyCard, type getCards } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';

// Asking the index questions that span VERSIONS of a type.
//
// The Atlas corpus carries `northwind/records` at three published Versions
// across a MAJOR boundary, and seven invoices spread over them:
//
//     1.0.1   legacy-invoice-1
//     1.3.0   invoice-1 … invoice-4
//     2.1.0   ng-invoice-1, ng-invoice-2
//
// The exact Versions move as the packages are republished — the ledger below
// derives them from the corpus rather than naming them — but the SHAPE of the
// spread does not: two lines of a 1.x, and one across the major boundary.
//
// The 2.x line is a deliberate shape break, built to be awkward in all four
// ways a major can be:
//
//     kept              invoiceNumber, issuedOn, dueOn
//     same name, new    `currency` was a field read as `currency.code`;
//     shape             now a bare string
//     renamed           `lines[].description` -> `items[].label`
//     added             `billTo`, invoice-level `taxRate`
//
// Type identity in the index is the RESOLVED module, so every instance stores
// one exact version. A filter naming a RANGE is rewritten into an `any` over
// the versions actually present before the query is compiled
// (`runtime-common/package-range-query.ts`). That is what makes a range
// answerable at all — and it is also what creates the interesting problem this
// console is really about: the expanded branches do not have to agree about
// their fields.
//
// So the samples come in three acts. The first asks questions the whole range
// can answer. The second asks questions only part of it can — and the answer
// arrives with a REPORT of which Versions sat the predicate out, rather than a
// silently shorter list or an exception. The third asks questions that are
// either stated precisely enough to need no caveat, or cannot be answered at
// all. Flip the policy to `strict` to refuse a partial answer instead. See
// docs/missing-field-query-semantics.md.
//
// THE LEDGER. A search only ever hands back the rows that matched, which is
// exactly the wrong shape for showing what a query DIDN'T ask. So the console
// runs a second, constant query for the whole invoice population and holds it
// beside the active one. Every instance in the corpus is then one dot, and the
// four states a dot can be in are the four outcomes of the semantics:
//
//     matched        the predicate was asked here, and answered yes
//     no match       asked here, answered no
//     not asked      this Version cannot answer the predicate (a reported skip)
//     out of scope   this Version is not in the range the filter named
//
// "Not asked" and "no match" look nothing alike, which is the entire argument
// of the design rendered as pixels.

interface Sample {
  act: number;
  label: string;
  note: string;
  build: (origin: string) => Record<string, unknown>;
}

const ACTS = [
  {
    title: 'The range holds',
    blurb: 'Questions every Version in the range can answer.',
  },
  {
    title: 'The shape moved',
    blurb: 'Questions only part of the range can answer.',
  },
  {
    title: 'Precision and refusal',
    blurb: 'Say the correspondence yourself — or ask for nothing that exists.',
  },
];

function invoiceRef(origin: string, spec: string) {
  return {
    module: `${origin}/atlas/_packages/northwind/records@${encodeURIComponent(
      spec,
    )}/index`,
    name: 'Invoice',
  };
}

const SAMPLES: Sample[] = [
  {
    act: 0,
    label: 'Every invoice, all versions',
    note: 'One range, three stored Versions across two majors. Expands to an `any` over the exact keys the index holds.',
    build: (o) => ({ filter: { type: invoiceRef(o, '*') } }),
  },
  {
    act: 0,
    label: 'Only the 1.x line',
    note: 'Five invoices. The caret stops at the major boundary, so the two 2.x rows are genuinely out of scope.',
    build: (o) => ({ filter: { type: invoiceRef(o, '^1.0.0') } }),
  },
  {
    act: 0,
    label: 'Only the 2.x line',
    note: 'Two invoices — the ones built on the breaking major.',
    build: (o) => ({ filter: { type: invoiceRef(o, '^2.0.0') } }),
  },
  {
    act: 0,
    label: 'A field that SURVIVED the break',
    note: '`dueOn` means the same thing in 1.x and 2.x, so one field path spans both majors and nothing is skipped.',
    build: (o) => ({
      filter: {
        on: invoiceRef(o, '*'),
        range: { dueOn: { gt: '2026-08-01' } },
      },
    }),
  },
  {
    act: 0,
    label: 'Full text crosses the break unaided',
    note: 'The one predicate that never names a field, so no shape can move under it. Three hits, three Versions, two majors.',
    build: () => ({ filter: { matches: 'Onboarding' } }),
  },
  {
    act: 1,
    label: 'A field whose SHAPE moved',
    note: '`currency.code` reads a field in 1.x; the 2.x major flattened `currency` to a string. Answers for 1.x, and reports the 2.x skip.',
    build: (o) => ({
      filter: { on: invoiceRef(o, '*'), eq: { 'currency.code': 'DEM' } },
    }),
  },
  {
    act: 1,
    label: 'A field that was RENAMED',
    note: '1.x spells it `lines[].description`. Two hits, and the 2.x Version is named as unable to answer.',
    build: (o) => ({
      filter: {
        on: invoiceRef(o, '*'),
        eq: { 'lines.description': 'Onboarding workshop' },
      },
    }),
  },
  {
    act: 1,
    label: '…and the same question from the other side',
    note: 'The 2.x spelling, `items[].label`. Now BOTH 1.x Versions are the ones that sit it out. Symmetric, and neither direction is privileged.',
    build: (o) => ({
      filter: {
        on: invoiceRef(o, '*'),
        eq: { 'items.label': 'Onboarding workshop' },
      },
    }),
  },
  {
    act: 1,
    label: 'Negation does not guess',
    note: 'A skipped predicate is UNKNOWN, and `NOT UNKNOWN` is UNKNOWN — so the 2.x rows are NOT swept in on the grounds that we failed to look. Compare this against the same filter pinned to ^1.0.0: identical.',
    build: (o) => ({
      filter: {
        on: invoiceRef(o, '*'),
        not: { eq: { 'currency.code': 'DEM' } },
      },
    }),
  },
  {
    act: 2,
    label: 'State the correspondence yourself',
    note: 'The GraphQL inline-fragment answer: one branch per shape, each naming its own spelling. Complete, and with no caveat attached.',
    build: (o) => ({
      filter: {
        any: [
          {
            on: invoiceRef(o, '^1.0.0'),
            eq: { 'lines.description': 'Onboarding workshop' },
          },
          {
            on: invoiceRef(o, '^2.0.0'),
            eq: { 'items.label': 'Onboarding workshop' },
          },
        ],
      },
    }),
  },
  {
    act: 2,
    label: 'A typo is still a typo',
    note: 'No Version has `invoiceNumbr`, so no branch can answer and the query FAILS rather than quietly matching nothing. This is the case leniency must not swallow.',
    build: (o) => ({
      filter: { on: invoiceRef(o, '*'), eq: { invoiceNumbr: 'NW-2001-0088' } },
    }),
  },
];

// The version a card actually resolved to. `identifyCard` reports the module
// the class came from, which after resolution is the exact package address.
function versionOf(card: unknown): string {
  let ref = identifyCard((card as any)?.constructor) as
    | { module?: string }
    | undefined;
  let match = (ref?.module ?? '').match(/@([^/]+)\/index/);
  return match ? decodeURIComponent(match[1]) : '—';
}

function parts(v: string): number[] | undefined {
  let m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function compare(a: number[], b: number[]) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Enough of a range check to label the ledger honestly for the forms a filter
// actually carries here. Anything it cannot parse is reported as in scope,
// so an unrecognized spec never claims a Version was excluded on purpose.
function inRange(spec: string, version: string): boolean {
  if (!spec || spec === '*' || spec === 'latest') {
    return true;
  }
  let v = parts(version);
  let m = spec.match(/^([\^~]?)(\d+\.\d+\.\d+)/);
  if (!v || !m) {
    return true;
  }
  let target = parts(m[2])!;
  let cmp = compare(v, target);
  if (m[1] === '^') {
    return v[0] === target[0] && cmp >= 0;
  }
  if (m[1] === '~') {
    return v[0] === target[0] && v[1] === target[1] && cmp >= 0;
  }
  return cmp === 0;
}

// Every package spec named anywhere in the filter, however deeply nested —
// `any` branches each carry their own `on`, and the union of them is the
// scope the whole query asked about.
function collectSpecs(node: unknown, out: Set<string>) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectSpecs(child, out));
    return;
  }
  for (let [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'module' && typeof value === 'string') {
      let m = value.match(/@([^/]+)\/index$/);
      if (m) {
        out.add(decodeURIComponent(m[1]));
      }
    } else {
      collectSpecs(value, out);
    }
  }
}

interface Dot {
  id: string;
  title: string;
  state: 'hit' | 'miss' | 'unknown' | 'oos';
}

class Isolated extends Component<typeof QueryConsole> {
  @tracked draft = '';
  @tracked activeQuery: Record<string, unknown> | undefined;
  @tracked parseError: string | undefined;
  @tracked ranLabel = '';
  @tracked strict = false;
  private results: ReturnType<getCards> | undefined;
  private everything: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.draft = this.args.model.query?.trim()
      ? this.args.model.query
      : this.pretty(SAMPLES[0].build(this.origin));
    this.run();
    this.results = this.args.context?.getCards(
      this,
      () => this.effectiveQuery,
      () => (this.realm ? [this.realm] : undefined),
    );
    // The constant population, held beside the active answer so the ledger can
    // show the rows a query did NOT return — which no search result contains.
    this.everything = this.args.context?.getCards(
      this,
      () => ({ filter: { type: invoiceRef(this.origin, '*') } }),
      () => (this.realm ? [this.realm] : undefined),
    );
  }

  // The policy rides on the query rather than the filter, so the toggle
  // re-runs the same question under the other rule — which is the comparison
  // worth being able to make in one click.
  private get effectiveQuery() {
    let base = this.activeQuery ?? {
      filter: { type: invoiceRef(this.origin, '*') },
    };
    return this.strict ? { ...base, onMissingField: 'error' } : base;
  }

  private get realm() {
    return this.args.model[realmURL]?.href;
  }

  get origin() {
    let href = this.args.model[realmURL]?.href;
    return href ? new URL(href).origin : '';
  }

  private pretty(q: unknown) {
    return JSON.stringify(q, null, 2);
  }

  // The rail lists the questions; the note for whichever one is loaded moves
  // to the editor as a brief. Keeping every note in the rail made one column
  // three times taller than the two beside it.
  get acts() {
    return ACTS.map((act, index) => ({
      title: act.title,
      blurb: act.blurb,
      numeral: String(index + 1).padStart(2, '0'),
      samples: SAMPLES.filter((s) => s.act === index).map((s) => ({
        label: s.label,
        json: this.pretty(s.build(this.origin)),
        state: this.ranLabel === s.label ? 'active' : 'idle',
      })),
    }));
  }

  get brief() {
    return SAMPLES.find((s) => s.label === this.ranLabel);
  }

  get instances() {
    return (this.results?.instances ?? []) as CardDef[];
  }

  // `cardTitle` is the field the Atlas records actually compute (the invoice
  // number); the base `title` is left unset on this corpus, so reading it
  // alone renders every hit as "(untitled)".
  private describe(card: CardDef) {
    return {
      id: card.id,
      title: ((card as any).cardTitle || '(untitled)') as string,
      version: versionOf(card),
    };
  }

  get hits() {
    return this.instances.map((card) => this.describe(card));
  }

  get population() {
    return ((this.everything?.instances ?? []) as CardDef[]).map((card) =>
      this.describe(card),
    );
  }

  // The point of the whole exercise: a short answer is never silent. Each entry
  // is one (type, path) the query asked about that this Version could not
  // answer.
  get skipped() {
    let entries = (this.results?.meta as any)?.skippedFilters ?? [];
    return entries.map((s: any) => {
      let module: string = s.type?.module ?? '';
      let match = module.match(/@([^/]+)\/index/);
      return {
        path: s.path,
        version: match ? decodeURIComponent(match[1]) : module,
        reason: s.reason,
      };
    });
  }

  get hasSkips() {
    return this.skipped.length > 0;
  }

  private get scopeSpecs() {
    let specs = new Set<string>();
    collectSpecs(this.effectiveQuery, specs);
    return [...specs];
  }

  // One row per stored Version: its population as dots, what the active query
  // did with each, and the one-word verdict for the Version as a whole.
  get versionRows() {
    let specs = this.scopeSpecs;
    let hitIds = new Set(this.hits.map((h) => h.id));
    let skips = this.skipped as { version: string; path: string }[];
    let versions = [...new Set(this.population.map((p) => p.version))].sort(
      (a, b) => {
        let pa = parts(a);
        let pb = parts(b);
        return pa && pb ? compare(pa, pb) : a.localeCompare(b);
      },
    );
    return versions.map((version) => {
      let mine = this.population.filter((p) => p.version === version);
      let ownSkips = skips.filter((s) => s.version === version);
      let inScope = specs.length === 0 || specs.some((s) => inRange(s, version));
      let matched = mine.filter((p) => hitIds.has(p.id));
      // A refused query asked nothing anywhere, so no row may be reported as
      // a non-match — the whole scope is unanswered.
      let unanswered = this.hasError || ownSkips.length > 0;
      let dots: Dot[] = mine.map((p) => ({
        id: p.id,
        title: p.title,
        state: !inScope
          ? 'oos'
          : hitIds.has(p.id)
            ? 'hit'
            : unanswered
              ? 'unknown'
              : 'miss',
      }));
      let verdict = !inScope
        ? 'out of scope'
        : this.hasError
          ? 'refused'
          : ownSkips.length > 0
            ? 'not asked'
            : matched.length > 0
              ? 'answered'
              : 'no match';
      return {
        version,
        dots,
        total: mine.length,
        matched: matched.length,
        tally: `${this.hasError ? '—' : matched.length} / ${mine.length}`,
        skips: ownSkips,
        verdict,
        state: !inScope
          ? 'oos'
          : unanswered
            ? 'unknown'
            : matched.length > 0
              ? 'hit'
              : 'miss',
      };
    });
  }

  get inScopeCount() {
    return this.versionRows
      .filter((v) => v.state !== 'oos')
      .reduce((sum, v) => sum + v.total, 0);
  }

  get corpusCount() {
    return this.population.length;
  }

  // The search resource reports failures as an `errors` ARRAY of ErrorEntry,
  // not a single `error`. Reading the wrong property here is not a cosmetic
  // miss: a refused query then renders as a successful empty answer, which is
  // the silent-wrong-answer this whole console exists to argue against.
  get searchErrors() {
    let entries = ((this.results as any)?.errors ?? []) as {
      error?: { status?: number; message?: string; title?: string };
    }[];
    return entries.map((entry) => ({
      status: entry.error?.status ?? 500,
      title: entry.error?.title ?? 'Search Error',
      message: entry.error?.message ?? 'The search failed.',
    }));
  }

  get hasError() {
    return this.searchErrors.length > 0;
  }

  // A refusal has no count. Showing 0 would claim the index looked and found
  // nothing, and it did not look at all.
  get answerValue() {
    return this.hasError ? '—' : String(this.count);
  }

  get answerUnit() {
    return this.hasError ? 'refused' : this.plural;
  }

  get isLoading() {
    return this.results?.isLoading ?? false;
  }

  get count() {
    return this.instances.length;
  }

  get plural() {
    return this.count === 1 ? 'result' : 'results';
  }

  get policy() {
    return this.strict ? 'strict' : 'tolerant';
  }

  @action updateDraft(event: Event) {
    this.draft = (event.target as HTMLTextAreaElement).value;
  }

  @action maybeRun(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.run();
    }
  }

  @action loadSample(json: string, label: string) {
    this.draft = json;
    this.ranLabel = label;
    this.run();
  }

  @action setStrict(strict: boolean) {
    this.strict = strict;
  }

  @action run() {
    try {
      let parsed = JSON.parse(this.draft);
      this.parseError = undefined;
      this.activeQuery = parsed;
    } catch (e: any) {
      // A typo in the JSON must not blank the results — the previous answer
      // stays on screen with the error beside it, so editing is not punished.
      this.parseError = e.message;
    }
  }

  <template>
    <section class='console'>
      <div class='sheet'>
        <header class='masthead'>
          <div class='mast-row'>
            <span class='eyebrow'>Atlas · northwind/records · three Versions ·
              two majors</span>
            <div class='policy' data-pos={{if this.strict '1' '0'}}>
              <span class='policy-hl'></span>
              <button
                type='button'
                class='policy-item'
                data-state={{if this.strict 'idle' 'active'}}
                {{on 'click' (fn this.setStrict false)}}
              >tolerant</button>
              <button
                type='button'
                class='policy-item'
                data-state={{if this.strict 'active' 'idle'}}
                {{on 'click' (fn this.setStrict true)}}
              >strict</button>
            </div>
          </div>
          <h1 class='display'>Ask across the break.</h1>
          <p class='deck'>Seven invoices, three published Versions, one shape
            break at the major boundary. A range query expands into a branch per
            Version — and the branches do not have to agree about their fields.
            What happens next is the whole design.</p>
        </header>

        <hr class='rule' />

        <section class='ledger'>
          <div class='ledger-head'>
            <span class='eyebrow'>The corpus · every instance, and what this
              query did with it</span>
            <span class='legend'>
              <span class='legend-item'><span
                  class='dot'
                  data-state='hit'
                ></span>matched</span>
              <span class='legend-item'><span
                  class='dot'
                  data-state='miss'
                ></span>no match</span>
              <span class='legend-item'><span
                  class='dot'
                  data-state='unknown'
                ></span>not asked</span>
              <span class='legend-item'><span
                  class='dot'
                  data-state='oos'
                ></span>out of scope</span>
            </span>
          </div>
          <div class='versions'>
            {{#each this.versionRows as |v|}}
              <article class='version' data-state={{v.state}}>
                <div class='version-top'>
                  <span class='token'>{{v.version}}</span>
                  <span class='verdict' data-state={{v.state}}>{{v.verdict}}</span>
                </div>
                <div class='dots'>
                  {{#each v.dots as |d|}}
                    <span class='dot' data-state={{d.state}} title={{d.title}}
                    ></span>
                  {{/each}}
                </div>
                <div class='version-foot'>
                  <span class='count'>{{v.tally}}</span>
                  {{#if this.hasError}}
                    <span class='missing'>nothing was asked</span>
                  {{else}}
                    {{#each v.skips as |s|}}
                      <span class='missing'>no
                        <code>{{s.path}}</code></span>
                    {{else}}
                      <span class='quiet'>all predicates asked</span>
                    {{/each}}
                  {{/if}}
                </div>
              </article>
            {{else}}
              <p class='quiet'>Reading the corpus…</p>
            {{/each}}
          </div>
        </section>

        <hr class='rule' />

        <div class='cols'>
          <aside class='rail'>
            {{#each this.acts as |act|}}
              <section class='act'>
                <div class='act-head'>
                  <span class='numeral'>{{act.numeral}}</span>
                  <span>
                    <span class='act-title'>{{act.title}}</span>
                    <span class='act-blurb'>{{act.blurb}}</span>
                  </span>
                </div>
                <ul class='samples'>
                  {{#each act.samples as |s|}}
                    <li>
                      <button
                        type='button'
                        class='sample'
                        data-state={{s.state}}
                        {{on 'click' (fn this.loadSample s.json s.label)}}
                      >{{s.label}}</button>
                    </li>
                  {{/each}}
                </ul>
              </section>
            {{/each}}
          </aside>

          <section class='ask'>
            <div class='pane-head'>
              <span class='eyebrow'>The question</span>
              <span class='kbd'>Cmd + Enter</span>
            </div>
            {{#if this.brief}}
              <div class='brief'>
                <span class='brief-label'>{{this.brief.label}}</span>
                <span class='brief-note'>{{this.brief.note}}</span>
              </div>
            {{else}}
              <div class='brief'>
                <span class='brief-label'>Pick a question, or write one</span>
                <span class='brief-note'>Each sample loads its filter here and
                  runs it. The corpus strip above then shows what the query did
                  with every instance, Version by Version.</span>
              </div>
            {{/if}}
            <textarea
              class='editor'
              spellcheck='false'
              aria-label='Query JSON'
              {{on 'input' this.updateDraft}}
              {{on 'keydown' this.maybeRun}}
            >{{this.draft}}</textarea>
            <div class='actions'>
              <button
                type='button'
                class='btn btn-primary'
                {{on 'click' this.run}}
              >Run query</button>
              {{#if this.isLoading}}
                <span class='shimmer'>running…</span>
              {{else}}
                <span class='quiet'>policy
                  <b>{{this.policy}}</b></span>
              {{/if}}
            </div>
            <p class='hint'>Tolerant is the default: a Version that cannot
              answer a predicate sits it out and is named, rather than matching
              nothing in silence. Strict refuses the partial answer and returns
              a 400.</p>
            {{#if this.parseError}}
              <div class='alert' data-tone='bad'>
                <span class='alert-title'>JSON</span>
                <span>{{this.parseError}}</span>
              </div>
            {{/if}}
            {{#each this.searchErrors as |e|}}
              <div class='alert' data-tone='bad'>
                <span class='alert-title'>{{e.status}}
                  ·
                  {{e.title}}</span>
                <span>{{e.message}}</span>
              </div>
            {{/each}}
          </section>

          <section class='answer'>
            <div class='pane-head'>
              <span class='eyebrow'>The answer</span>
              {{#if this.ranLabel}}<span class='ran'>{{this.ranLabel}}</span>{{/if}}
            </div>
            <div class='stat' data-tone={{if this.hasError 'bad' 'ok'}}>
              <span class='stat-value'>{{this.answerValue}}</span>
              <span class='stat-unit'>{{this.answerUnit}}</span>
              <span class='stat-of'>of
                {{this.inScopeCount}}
                in scope ·
                {{this.corpusCount}}
                in the corpus</span>
            </div>

            {{#if this.hasError}}
              <div class='alert' data-tone='bad'>
                <span class='alert-title'>No partial answer</span>
                <span>Strict was asked for, and at least one Version could not
                  answer a predicate, so the whole query is refused. Nothing
                  below was matched or ruled out — the index never looked.</span>
              </div>
            {{/if}}

            {{#if this.hasSkips}}
              <div class='alert' data-tone='warn'>
                <span class='alert-title'>Not asked</span>
                <span>Complete for every Version that could answer. These could
                  not:</span>
                <ul class='skips'>
                  {{#each this.skipped as |s|}}
                    <li>
                      <span class='token' data-tone='warn'>{{s.version}}</span>
                      has no
                      <code>{{s.path}}</code>
                      <span class='reason'>{{s.reason}}</span>
                    </li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}

            <ul class='hits'>
              {{#each this.hits as |hit|}}
                <li class='hit'>
                  <span class='token'>{{hit.version}}</span>
                  <span class='hit-title'>{{hit.title}}</span>
                </li>
              {{else}}
                <li class='empty'>
                  <span class='empty-title'>Nothing matched.</span>
                  <span class='empty-msg'>An empty answer here means asked and
                    answered no — never asked and skipped. The ledger above says
                    which.</span>
                </li>
              {{/each}}
            </ul>
          </section>
        </div>

        <footer class='foot'>
          <span class='eyebrow'>index identity is the resolved module · ranges
            expand before compile</span>
          <span class='eyebrow'>docs/missing-field-query-semantics.md</span>
        </footer>
      </div>
    </section>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600&display=swap');

      /* Every value here is an ALIAS onto the realm theme (the PretUI Theme
         card linked from cardInfo.theme), never a literal. A literal would
         shadow the theme's `.dark` scope and strand this card in light mode
         while the rest of the app switched. Fallbacks cover the case where
         the card is read without the theme attached. */
      .console {
        container-type: inline-size;
        --bg: var(--background, oklch(0.977 0.007 290));
        --ink: var(--foreground, oklch(0.248 0.02 305));
        --muted: var(--muted-foreground, color-mix(in srgb, var(--ink) 62%, var(--card)));
        --primary-fg: var(--primary-foreground, oklch(0.248 0.02 305));
        --primary-ink: var(--pretui-primary-ink, oklch(0.47 0.14 164));
        --warning-ink: var(--pretui-warning-ink, oklch(0.48 0.11 80));
        --shadow-soft: var(--shadow-ink-soft, oklch(0.2 0.015 290 / 0.05));
        --shadow-mid: var(--shadow-ink-mid, oklch(0.2 0.015 290 / 0.08));
        --hairline: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        --sh-control: var(
          --pretui-shadow-control,
          0 0 0 1px var(--border),
          0 1px 2px var(--shadow-soft)
        );
        --sh-card: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 2px 6px var(--shadow-soft)
        );
        --sh-inset: var(--pretui-shadow-inset, inset 0 1px 2px var(--shadow-mid));
        --edge: var(--pretui-edge-highlight, inset 0 1px 0 oklch(1 0 0 / 0.14));
        --sans: var(--font-sans, 'IBM Plex Sans', system-ui, sans-serif);
        --mono: var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace);
        --serif: var(--font-serif, 'IBM Plex Serif', Georgia, serif);
        --snap: var(--pretui-ease-snap, cubic-bezier(0.2, 0.9, 0.25, 1.05));
        background: var(--bg);
        color: var(--ink);
        font-family: var(--sans);
        font-size: 15px;
        line-height: 1.6;
        letter-spacing: 0.01em;
        min-height: 100%;
        -webkit-font-smoothing: antialiased;
      }

      .sheet {
        max-width: 1480px;
        margin: 0 auto;
        padding: 26px 28px 34px;
      }

      /* ── voices ─────────────────────────────────────────────── */
      .eyebrow {
        font-family: var(--mono);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .display {
        margin: 10px 0 0;
        font-family: var(--serif);
        font-weight: 400;
        font-size: 40px;
        line-height: 1.06;
        letter-spacing: -0.015em;
      }
      .deck {
        margin: 10px 0 0;
        max-width: 68ch;
        font-size: 14px;
        line-height: 1.65;
        color: var(--muted);
        text-wrap: pretty;
      }
      .quiet {
        font-size: 12px;
        color: var(--ink-3);
      }
      .quiet b {
        color: var(--muted);
        font-weight: 600;
      }
      code {
        font-family: var(--mono);
        font-size: 0.88em;
      }
      .rule {
        height: 1px;
        border: 0;
        margin: 22px 0;
        background: var(--border);
      }

      /* Law 3 — machine values look like machine values. */
      .token {
        display: inline-block;
        font-family: var(--mono);
        font-size: 11.5px;
        font-weight: 500;
        padding: 1px 6px;
        border-radius: 5px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        background: color-mix(in srgb, var(--primary) 8%, var(--card));
        color: color-mix(in srgb, var(--ink) 22%, var(--primary-ink));
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--primary-ink) 28%, var(--border));
      }
      .token[data-tone='warn'] {
        background: color-mix(in srgb, var(--warning) 14%, var(--card));
        color: color-mix(in srgb, var(--ink) 26%, var(--warning-ink));
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--warning) 40%, var(--border));
      }
      .kbd {
        font-family: var(--mono);
        font-size: 10.5px;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--inset);
        color: var(--ink-3);
        box-shadow: var(--hairline);
      }

      /* ── masthead + the policy switch ───────────────────────── */
      .mast-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      /* Law 5 — the highlight TRAVELS between the two policies, because the
         movement is the state change. */
      .policy {
        position: relative;
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        background: var(--inset);
        border-radius: 12px;
        box-shadow: var(--sh-inset);
        flex: none;
      }
      .policy-hl {
        position: absolute;
        top: 2px;
        left: 2px;
        width: calc(50% - 3px);
        height: calc(100% - 4px);
        border-radius: var(--radius);
        background: var(--card);
        box-shadow: var(--sh-control);
        transition: transform 180ms var(--snap);
      }
      .policy[data-pos='1'] .policy-hl {
        transform: translateX(calc(100% + 2px));
      }
      .policy-item {
        position: relative;
        min-width: 78px;
        height: 24px;
        padding: 0 12px;
        border: 0;
        background: none;
        border-radius: var(--radius);
        font: inherit;
        font-family: var(--mono);
        font-size: 11.5px;
        font-weight: 500;
        color: var(--muted);
        cursor: pointer;
      }
      .policy-item[data-state='active'] {
        color: var(--ink);
      }

      /* ── the ledger ─────────────────────────────────────────── */
      .ledger-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .legend {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: var(--muted);
      }
      .versions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
        gap: 12px;
      }
      .version {
        background: var(--card);
        border-radius: var(--radius);
        box-shadow: var(--sh-card);
        padding: 12px 14px 11px;
        display: grid;
        gap: 10px;
        align-content: start;
      }
      .version[data-state='oos'] {
        background: var(--inset);
        box-shadow: var(--hairline);
      }
      .version-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .verdict {
        font-family: var(--mono);
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ink-3);
      }
      .verdict[data-state='hit'] {
        color: var(--primary-ink);
      }
      .verdict[data-state='unknown'] {
        color: var(--warning-ink);
      }
      /* Law 4 — discrete beats continuous: one dot per instance, never a bar. */
      .dots {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .dot {
        width: 11px;
        height: 11px;
        border-radius: 3px;
        flex: none;
        background: var(--inset);
        box-shadow: inset 0 0 0 1px var(--line-strong);
      }
      .dot[data-state='hit'] {
        background: var(--primary);
        box-shadow: inset 0 0 0 1px
          color-mix(in srgb, var(--primary) 60%, var(--ink));
      }
      .dot[data-state='unknown'] {
        background: repeating-linear-gradient(
          -45deg,
          color-mix(in srgb, var(--warning) 55%, var(--card)) 0 2px,
          var(--card) 2px 4px
        );
        box-shadow: inset 0 0 0 1px var(--warning);
      }
      .dot[data-state='oos'] {
        background: transparent;
        box-shadow: inset 0 0 0 1px var(--border);
      }
      .version-foot {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .count {
        font-family: var(--mono);
        font-size: 12.5px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .missing {
        font-size: 11.5px;
        color: var(--warning-ink);
      }

      /* ── three columns ──────────────────────────────────────── */
      .cols {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 22px;
        align-items: start;
      }
      @container (min-width: 880px) {
        .cols {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        .rail {
          grid-column: 1 / -1;
        }
      }
      @container (min-width: 1180px) {
        .cols {
          grid-template-columns: 19rem minmax(0, 1fr) minmax(0, 1.05fr);
          gap: 30px;
        }
        .rail {
          grid-column: auto;
        }
        .display {
          font-size: 52px;
        }
        .sheet {
          padding: 32px 44px 44px;
        }
      }

      /* ── the rail ───────────────────────────────────────────── */
      .rail {
        display: grid;
        gap: 20px;
        align-content: start;
      }
      .act-head {
        display: grid;
        grid-template-columns: 32px 1fr;
        gap: 10px;
        align-items: baseline;
        padding-bottom: 8px;
        box-shadow: 0 1px 0 var(--border);
      }
      .numeral {
        font-family: var(--serif);
        font-size: 24px;
        line-height: 1;
        color: var(--ink-3);
      }
      .act-title {
        display: block;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .act-blurb {
        display: block;
        font-size: 11.5px;
        line-height: 1.5;
        color: var(--ink-3);
      }
      .samples {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        display: grid;
        gap: 3px;
      }
      .sample {
        display: block;
        width: 100%;
        text-align: left;
        padding: 6px 10px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        line-height: 1.45;
        letter-spacing: -0.005em;
        cursor: pointer;
        transition:
          background 180ms var(--snap),
          box-shadow 180ms var(--snap),
          color 180ms var(--snap);
      }
      .sample:hover {
        background: var(--hover);
        color: var(--ink);
      }
      .sample[data-state='active'] {
        background: var(--card);
        color: var(--primary-ink);
        box-shadow: var(--sh-control);
      }

      /* ── ask + answer panes ─────────────────────────────────── */
      .pane-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 8px;
        margin-bottom: 10px;
        box-shadow: 0 1px 0 var(--border);
      }
      .ran {
        font-size: 11.5px;
        color: var(--ink-3);
        text-align: right;
      }
      .brief {
        display: grid;
        gap: 2px;
        margin-bottom: 12px;
        padding-left: 11px;
        box-shadow: inset 2px 0 0 var(--primary);
      }
      .brief-label {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .brief-note {
        font-size: 12px;
        line-height: 1.55;
        color: var(--muted);
        text-wrap: pretty;
      }
      .editor {
        display: block;
        width: 100%;
        min-height: 19rem;
        padding: 11px 12px;
        border: 0;
        border-radius: var(--radius);
        background: var(--field);
        color: var(--ink);
        box-shadow:
          0 0 0 1px var(--border),
          var(--sh-inset);
        font-family: var(--mono);
        font-size: 12.5px;
        line-height: 1.65;
        tab-size: 2;
        resize: vertical;
      }
      .editor:focus {
        outline: none;
        box-shadow:
          0 0 0 1px var(--primary),
          0 0 0 3px color-mix(in srgb, var(--primary) 35%, transparent),
          var(--sh-inset);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
        transition:
          background 180ms var(--snap),
          transform 80ms ease;
      }
      .btn:active {
        transform: translateY(0.5px);
      }
      .btn-primary {
        background: var(--primary);
        color: var(--primary-fg);
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--primary) 70%, var(--border)),
          var(--edge),
          0 1px 2px var(--shadow-mid);
      }
      .btn-primary:hover {
        background: color-mix(in srgb, var(--ink) 10%, var(--primary));
      }
      @keyframes shimmer {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
      .shimmer {
        font-size: 12.5px;
        font-weight: 500;
        background-image: linear-gradient(
          90deg,
          var(--ink-3) 35%,
          var(--ink) 50%,
          var(--ink-3) 65%
        );
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: shimmer 1.4s linear infinite;
      }
      .hint {
        margin: 10px 0 0;
        font-size: 11.5px;
        line-height: 1.55;
        color: var(--ink-3);
        max-width: 56ch;
      }

      /* Law 2 — one hue in, a complete treatment out. */
      .alert {
        display: grid;
        gap: 6px;
        margin-top: 14px;
        padding: 10px 12px;
        border-radius: var(--radius);
        font-size: 12.5px;
        line-height: 1.55;
        --hue: var(--warning);
        background: color-mix(in srgb, var(--hue) 16%, var(--card));
        color: color-mix(in srgb, var(--ink) 46%, var(--hue));
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--hue) 30%, var(--border));
      }
      .alert[data-tone='bad'] {
        --hue: var(--destructive);
      }
      .alert-title {
        font-weight: 600;
        letter-spacing: -0.005em;
        color: color-mix(in srgb, var(--ink) 60%, var(--hue));
      }
      .alert code {
        font-size: 11.5px;
      }
      .skips {
        list-style: none;
        margin: 2px 0 0;
        padding: 0;
        display: grid;
        gap: 4px;
      }
      .skips li {
        display: flex;
        align-items: baseline;
        gap: 6px;
        flex-wrap: wrap;
      }
      .reason {
        font-family: var(--mono);
        font-size: 10.5px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.72;
      }

      /* ── the answer ─────────────────────────────────────────── */
      .stat {
        display: flex;
        align-items: last baseline;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .stat[data-tone='bad'] .stat-value {
        color: var(--destructive);
      }
      .stat-value {
        font-size: 44px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.03em;
        font-variant-numeric: tabular-nums;
      }
      .stat-unit {
        font-size: 14px;
        color: var(--muted);
      }
      .stat-of {
        font-size: 11.5px;
        color: var(--ink-3);
        margin-left: auto;
        text-align: right;
      }
      .hits {
        list-style: none;
        margin: 14px 0 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }
      .hit {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        border-radius: 8px;
        background: var(--card);
        box-shadow: var(--hairline);
        animation: fade-up 250ms cubic-bezier(0.23, 1, 0.32, 1) both;
      }
      @keyframes fade-up {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .hit:nth-child(even) {
        background: var(--stripe);
      }
      .hit-title {
        font-family: var(--mono);
        font-size: 12.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Law 6 — texture lives only in the empty state. */
      .empty {
        display: grid;
        gap: 6px;
        justify-items: center;
        text-align: center;
        padding: 40px 24px;
        border-radius: var(--radius);
        background: radial-gradient(
          ellipse 60% 45% at 50% 42%,
          color-mix(in srgb, var(--primary) 9%, transparent),
          transparent 70%
        );
      }
      .empty-title {
        font-family: var(--serif);
        font-size: 19px;
      }
      .empty-msg {
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--muted);
        max-width: 38ch;
      }

      .foot {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-top: 30px;
        padding-top: 12px;
        box-shadow: 0 -1px 0 var(--border);
      }

      @media (prefers-reduced-motion: reduce) {
        .hit,
        .shimmer,
        .policy-hl,
        .sample {
          animation-duration: 0.01ms;
          animation-iteration-count: 1;
          transition-duration: 0.01ms;
        }
      }
    </style>
  </template>
}

export class QueryConsole extends CardDef {
  static displayName = 'Version Query Console';
  // Three panes side by side — rail, question, answer — plus a ledger strip
  // that wants every instance in the corpus on one row. The layout degrades
  // to two columns and then one, but it is designed for the full stack width.
  static prefersWideFormat = true;

  // Persisted so an edited query survives a reload; the isolated template
  // keeps its own draft so typing does not write to the realm on every
  // keystroke.
  @field query = contains(TextAreaField);

  static isolated = Isolated;
}
