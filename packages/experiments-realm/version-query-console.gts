import {
  CardDef,
  Component,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import { identifyCard, type getCards } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';

// A console for asking the index questions about VERSIONS.
//
// The corpus in `greeter-corpus/` adopts from `experiments/greeter` across
// eight published Versions and two majors, spelled every way an author might
// spell it — exact pins, carets, tildes, explicit intervals, `2.x`. All of
// that collapses at index time to ONE exact resolved version per instance
// (`deck-the-range-is-on-disk.md` §0), which is what makes the interesting
// question askable: a filter naming a RANGE has to match rows stored as
// POINTS. `runtime-common/package-range-query.ts` rewrites the range into an
// `any` over the versions the index actually holds, before the query is
// compiled.
//
// The samples below are the point of this card. Run them, then edit the JSON
// and run your own — the textarea is the query, not a preview of it.

interface Sample {
  label: string;
  note: string;
  build: (origin: string) => Record<string, unknown>;
}

function greeterRef(origin: string, spec: string) {
  return {
    module: `${origin}/_packages/experiments/greeter@${encodeURIComponent(spec)}/index.js`,
    name: 'Greeter',
  };
}

const SAMPLES: Sample[] = [
  {
    label: 'Everything on ^2.0.0',
    note: 'One range, many stored versions. Expands to an `any` over every 2.x the index holds.',
    build: (o) => ({ filter: { type: greeterRef(o, '^2.0.0') } }),
  },
  {
    label: 'Only ~2.2.0',
    note: 'A tilde stays inside the minor, so this matches strictly fewer rows than ^2.0.0.',
    build: (o) => ({ filter: { type: greeterRef(o, '~2.2.0') } }),
  },
  {
    label: 'An explicit interval',
    note: '>=2.3.0 <2.5.0 — the versions in between, and nothing else.',
    build: (o) => ({ filter: { type: greeterRef(o, '>=2.3.0 <2.5.0') } }),
  },
  {
    label: 'One exact Version',
    note: 'No expansion happens — an exact spec is already the stored key.',
    build: (o) => ({ filter: { type: greeterRef(o, '2.2.0') } }),
  },
  {
    label: 'The old major, ^1.0.0',
    note: 'v1 Greeter has a `name` field where v2 has `person`. Different type, different shape.',
    build: (o) => ({ filter: { type: greeterRef(o, '^1.0.0') } }),
  },
  {
    label: 'Full text: "compilers"',
    note: 'A `matches` filter searches text across the corpus, no type named at all.',
    build: () => ({ filter: { matches: 'compilers' } }),
  },
  {
    label: 'Range AND full text',
    note: 'The composition that motivates the feature: search the text of everything on ^2.',
    build: (o) => ({
      filter: {
        every: [{ type: greeterRef(o, '^2.0.0') }, { matches: 'proof' }],
      },
    }),
  },
  {
    label: 'Range AND a field predicate',
    note: 'The composition the whole feature is for: `on` carries the range, and the `eq` rides along onto every expanded branch.',
    build: (o) => ({
      filter: { on: greeterRef(o, '^2.0.0'), eq: { person: 'Ada' } },
    }),
  },
  {
    label: 'A range nothing satisfies',
    note: 'Left un-rewritten on purpose, so it matches nothing instead of everything.',
    build: (o) => ({ filter: { type: greeterRef(o, '^9.0.0') } }),
  },
];

class Isolated extends Component<typeof VersionQueryConsole> {
  @tracked draft = '';
  @tracked activeQuery: Record<string, unknown> | undefined;
  @tracked parseError: string | undefined;
  @tracked ranLabel = '';
  private results: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.draft = this.args.model.query?.trim()
      ? this.args.model.query
      : this.pretty(SAMPLES[0].build(this.origin));
    this.run();
    this.results = this.args.context?.getCards(
      this,
      () => this.activeQuery ?? { filter: { type: greeterRef(this.origin, '^2.0.0') } },
      () => (this.realm ? [this.realm] : undefined),
    );
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

  get samples() {
    return SAMPLES.map((s) => ({
      label: s.label,
      note: s.note,
      json: this.pretty(s.build(this.origin)),
    }));
  }

  get instances() {
    return (this.results?.instances ?? []) as CardDef[];
  }

  // Each hit with the VERSION it actually resolved to. This is the column
  // worth looking at: ask for `^2.0.0` and the answers come back spread
  // across 2.1.0 … 2.5.0, which is the whole point — one range, many stored
  // versions. `identifyCard` reports the module the class came from, which
  // after resolution is the exact package address.
  get hits() {
    return this.instances.map((card) => {
      let ref = identifyCard(card.constructor as any) as
        | { module?: string }
        | undefined;
      let module = ref?.module ?? '';
      let match = module.match(/@([^/]+)\/index/);
      return {
        id: card.id,
        title: card.title ?? '(untitled)',
        version: match ? decodeURIComponent(match[1]) : '—',
      };
    });
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

  @action updateDraft(event: Event) {
    this.draft = (event.target as HTMLTextAreaElement).value;
  }

  @action loadSample(json: string, label: string) {
    this.draft = json;
    this.ranLabel = label;
    this.run();
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
      <header>
        <h1>Version Query Console</h1>
        <p class='sub'>The index stores one exact version per instance. These
          queries ask for ranges.</p>
      </header>

      <div class='cols'>
        <div class='pane'>
          <h2>Samples</h2>
          <ul class='samples'>
            {{#each this.samples as |s|}}
              <li>
                <button
                  type='button'
                  class='sample'
                  {{on 'click' (fn this.loadSample s.json s.label)}}
                >{{s.label}}</button>
                <span class='note'>{{s.note}}</span>
              </li>
            {{/each}}
          </ul>
        </div>

        <div class='pane'>
          <h2>Query</h2>
          <textarea
            class='editor'
            spellcheck='false'
            aria-label='Query JSON'
            {{on 'input' this.updateDraft}}
          >{{this.draft}}</textarea>
          <div class='actions'>
            <button type='button' class='run' {{on 'click' this.run}}>Run</button>
            {{#if this.isLoading}}<span class='status'>running…</span>{{/if}}
          </div>
          {{#if this.parseError}}
            <p class='error'>JSON error: {{this.parseError}}</p>
          {{/if}}
        </div>
      </div>

      <div class='results'>
        <h2>{{this.count}}
          {{this.plural}}
          {{#if this.ranLabel}}<span class='ran'>— {{this.ranLabel}}</span>{{/if}}
        </h2>
        <ul class='hits'>
          {{#each this.hits as |hit|}}
            <li class='hit'>
              <span class='ver'>{{hit.version}}</span>
              <span class='hit-title'>{{hit.title}}</span>
            </li>
          {{else}}
            <li class='empty'>Nothing matched.</li>
          {{/each}}
        </ul>
      </div>
    </section>

    <style scoped>
      .console {
        padding: 1.25rem;
        font: 400 14px/1.5 system-ui, sans-serif;
      }
      h1 {
        margin: 0;
        font-size: 1.4rem;
      }
      .sub {
        margin: 0.25rem 0 1rem;
        color: #666;
      }
      h2 {
        margin: 0 0 0.5rem;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #777;
      }
      .cols {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
        gap: 1.25rem;
        align-items: start;
      }
      .samples {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.5rem;
      }
      .samples li {
        display: grid;
        gap: 0.15rem;
      }
      .sample {
        justify-self: start;
        padding: 0.3rem 0.6rem;
        border: 1px solid #ccd;
        border-radius: 6px;
        background: #f6f7fb;
        cursor: pointer;
        font: inherit;
      }
      .sample:hover {
        background: #eceffb;
      }
      .note {
        color: #777;
        font-size: 0.8rem;
      }
      .editor {
        width: 100%;
        min-height: 16rem;
        padding: 0.6rem;
        border: 1px solid #ccd;
        border-radius: 6px;
        font-family: ui-monospace, monospace;
        font-size: 0.8rem;
        resize: vertical;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-top: 0.5rem;
      }
      .run {
        padding: 0.35rem 0.9rem;
        border: 0;
        border-radius: 6px;
        background: #2f57d6;
        color: #fff;
        cursor: pointer;
        font: inherit;
      }
      .status {
        color: #777;
      }
      .error {
        margin: 0.5rem 0 0;
        color: #b00;
        font-family: ui-monospace, monospace;
        font-size: 0.8rem;
      }
      .results {
        margin-top: 1.5rem;
      }
      .ran {
        color: #999;
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
      }
      .hits {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: 0.4rem;
      }
      .hit {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        padding: 0.35rem 0.5rem;
        background: #f6f7fb;
        border-radius: 6px;
      }
      .ver {
        flex: none;
        padding: 0.05rem 0.35rem;
        border-radius: 4px;
        background: #2f57d6;
        color: #fff;
        font-family: ui-monospace, monospace;
        font-size: 0.7rem;
      }
      .hit-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        color: #999;
      }
    </style>
  </template>
}

export class VersionQueryConsole extends CardDef {
  static displayName = 'Version Query Console';

  @field title = contains(StringField);
  // Persisted so an edited query survives a reload; the isolated template
  // keeps its own draft so typing does not write to the realm on every
  // keystroke.
  @field query = contains(TextAreaField);

  static isolated = Isolated;
}
