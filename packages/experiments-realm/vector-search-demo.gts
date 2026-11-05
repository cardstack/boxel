import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';

import {
  codeRef,
  identifyCard,
  VectorSerializer,
  type getCards,
} from '@cardstack/runtime-common';

import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
  realmURL,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import VectorField from '@cardstack/base/vector';
import SendRequestViaProxyTool from '@cardstack/boxel-host/tools/send-request-via-proxy';
import { Button } from '@cardstack/pretui/components/button';
import { Input as TextInput } from '@cardstack/pretui/components/input';
import { SegmentedControl } from '@cardstack/pretui/components/segmented-control';

// Search by meaning over cards that carry an embedding, in the realm's own
// index. A question ranks by its words as soon as it is typed; once it has
// been embedded, cards similar in meaning join and every signal (words,
// meaning, popularity, recency) is fused into one order by `_blend`. When the
// embedding can't be made, the words still rank, any of them.

// One embedding model and size for the stored vectors and the questions, so
// the two are comparable. The field carries both as statics.
export class MomentEmbedding extends VectorField {
  static displayName = 'Moment embedding';
  static dimensions = 256;
  static embeddingModel = 'qwen/qwen3-embedding-8b';
}

const talkMomentRef = codeRef(
  import.meta.url,
  './vector-search-demo',
  'TalkMoment',
);

// A quotable moment in a talk. Its embedding is of `${title}. ${quote}`.
export class TalkMoment extends CardDef {
  static displayName = 'Talk Moment';
  @field title = contains(StringField);
  @field speaker = contains(StringField);
  @field quote = contains(TextAreaField);
  @field startsAt = contains(NumberField); // seconds into the talk
  @field recommenders = contains(NumberField); // engagement
  @field lastDiscussed = contains(DateField); // recency
  @field embedding = contains(MomentEmbedding);

  // "More like this" is a declared query: the nearest other moments by
  // meaning. The type filter keeps out other cards with an `embedding` field.
  @field related = linksToMany(() => TalkMoment, {
    query: {
      filter: {
        every: [{ type: talkMomentRef }, { not: { eq: { id: '$this.id' } } }],
      },
      sort: [{ on: talkMomentRef, by: 'embedding', near: '$this.embedding' }],
      page: { size: 3 },
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: TalkMoment) {
      return this.title;
    },
  });

  static embedded = class Embedded extends Component<typeof TalkMoment> {
    <template>
      <article class='moment'>
        <blockquote>{{@model.quote}}</blockquote>
        <p class='source'>
          <b>{{@model.speaker}}</b>,
          <i>{{@model.title}}</i>
          at
          <time>{{clock @model.startsAt}}</time>
        </p>
      </article>
      <style scoped>
        .moment {
          padding: var(--boxel-sp-sm);
        }
        blockquote {
          margin: 0;
          font-size: var(--boxel-font-size);
          line-height: 1.4;
        }
        .source {
          margin: var(--boxel-sp-xs) 0 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
        time {
          font-family: var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof TalkMoment> {
    <template>
      <article class='moment-page'>
        <@fields.embedding @format='embedded' />
        <blockquote>{{@model.quote}}</blockquote>
        <p class='source'>
          <b>{{@model.speaker}}</b>,
          <i>{{@model.title}}</i>
          at
          <time>{{clock @model.startsAt}}</time>
          ·
          {{@model.recommenders}}
          recommenders
        </p>
        <h3>Related by meaning</h3>
        <@fields.related @format='embedded' />
      </article>
      <style scoped>
        .moment-page {
          padding: var(--boxel-sp-lg);
          display: grid;
          gap: var(--boxel-sp);
        }
        blockquote {
          margin: 0;
          font-size: var(--boxel-font-size-lg);
          line-height: 1.4;
        }
        .source {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h3 {
          margin: var(--boxel-sp) 0 0;
        }
      </style>
    </template>
  };
}

function clock(seconds: number | null | undefined) {
  let s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Lens = 'best' | 'popular' | 'recent';
type Weights = {
  words: number;
  meaning: number;
  recommenders: number;
  recency: number;
};
// Each lens is the same four signals, weighted differently.
const LENSES: Record<Lens, Weights> = {
  best: { words: 1, meaning: 2, recommenders: 0.5, recency: 0.5 },
  popular: { words: 1, meaning: 1, recommenders: 2, recency: 0.5 },
  recent: { words: 1, meaning: 1, recommenders: 0.5, recency: 2 },
};
const LENS_OPTIONS = [
  { value: 'best', label: 'Best match' },
  { value: 'popular', label: 'Popular' },
  { value: 'recent', label: 'Recent' },
];
// Below this cosine similarity a moment isn't about the question. The floor
// depends on the model and the corpus: here unrelated moments score about
// 0.40-0.50 and related ones 0.55 and up. Calibrate it by ranking a few
// questions with a `near` sort and reading each result's `_nearSimilarity`.
const MIN_SIMILARITY = 0.55;
const EXAMPLES = [
  'how do computers agree with each other',
  'why do programs break when data changes',
  'making AI do what we actually want',
];

// Embeddings for questions already asked, so asking again is instant.
const questionVectors = new Map<string, number[]>();

// The question's embedding, from the same model and size as the stored
// vectors, through the realm server's proxy (billed to the signed-in user).
async function embedQuestion(toolContext: any, text: string) {
  let { response } = await new SendRequestViaProxyTool(toolContext).execute({
    url: 'https://openrouter.ai/api/v1/embeddings',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    requestBody: JSON.stringify({
      model: MomentEmbedding.embeddingModel,
      dimensions: MomentEmbedding.dimensions,
      input: [text],
    }),
  });
  let json = response.ok ? await response.json() : undefined;
  let vector: unknown = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== MomentEmbedding.dimensions) {
    throw new Error(
      json?.error?.message ?? `embedding failed (${response.status})`,
    );
  }
  return vector as number[];
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

class Isolated extends Component<typeof VectorSearchDemo> {
  // The question's vector is derived from the question, not form state: it
  // follows `@model.question` and is dropped when the question changes.
  @tracked target: number[] | undefined;
  @tracked targetFor: string | undefined;
  @tracked embedding = false;
  @tracked meaningDown = false;
  private results: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.results = this.args.context?.getCards(
      this,
      () => this.query,
      () => this.realms,
      { isLive: true },
    );
  }

  get realms() {
    let url = this.args.model[realmURL];
    return url ? [url.href] : undefined;
  }
  get question() {
    return (this.args.model.question ?? '').trim();
  }
  get lens(): Lens {
    let lens = this.args.model.lens as Lens;
    return lens in LENSES ? lens : 'best';
  }
  get vector() {
    return this.targetFor === this.question ? this.target : undefined;
  }

  // The whole search is one query: filters for what may match, then one
  // `_blend` sort fusing the lens's signals by reciprocal rank.
  get query() {
    let ref = identifyCard(TalkMoment);
    if (!ref) {
      return undefined;
    }
    let question = this.question;
    let vector = this.vector;
    let weights = LENSES[this.lens];
    if (!question) {
      return {
        filter: { on: ref },
        sort: [{ on: ref, by: 'recommenders', direction: 'desc' as const }],
      };
    }
    let words = question.split(/\s+/).filter(Boolean);
    // Without meaning, any of the words may match, best first; with it, a
    // moment matches by its words or by being close in meaning.
    let wordsTerm = {
      on: ref,
      matches:
        this.meaningDown && words.length > 1 ? words.join(' or ') : question,
    };
    let filter = vector
      ? {
          any: [
            wordsTerm,
            {
              on: ref,
              near: {
                embedding: { to: vector, minSimilarity: MIN_SIMILARITY },
              },
            },
          ],
        }
      : wordsTerm;
    let of: any[] = [{ by: '_matchRelevance', weight: weights.words }];
    if (vector) {
      of.push({
        on: ref,
        by: 'embedding',
        near: vector,
        weight: weights.meaning,
      });
    }
    of.push(
      { on: ref, by: 'recommenders', weight: weights.recommenders },
      { on: ref, by: 'lastDiscussed', weight: weights.recency },
    );
    return { filter, sort: [{ by: '_blend', k: 60, of }], page: { size: 10 } };
  }

  get queryJSON() {
    return JSON.stringify(
      this.query,
      (key, value) =>
        key === 'to' || (key === 'near' && Array.isArray(value))
          ? `[…${MomentEmbedding.dimensions} numbers]`
          : value,
      2,
    );
  }

  get rows() {
    let vector = this.vector;
    return ((this.results?.instances ?? []) as TalkMoment[]).map((moment) => ({
      moment,
      similarity:
        vector && moment.embedding
          ? cosine(VectorSerializer.decodeVector(moment.embedding), vector)
          : undefined,
    }));
  }

  setQuestion = (value: string) => {
    this.args.model.question = value;
  };
  setLens = (value: string) => {
    this.args.model.lens = value;
  };

  ask = async (event?: Event) => {
    event?.preventDefault();
    let question = this.question;
    if (!question) {
      return;
    }
    let cached = questionVectors.get(question.toLowerCase());
    if (cached) {
      [this.target, this.targetFor] = [cached, question];
      return;
    }
    let toolContext = this.args.context?.toolContext;
    if (!toolContext) {
      this.meaningDown = true;
      return;
    }
    this.embedding = true;
    try {
      let vector = await embedQuestion(toolContext, question.slice(0, 500));
      questionVectors.set(question.toLowerCase(), vector);
      this.meaningDown = false;
      [this.target, this.targetFor] = [vector, question];
    } catch {
      // Meaning unavailable (no credits, the provider down): words still rank.
      this.meaningDown = true;
    } finally {
      this.embedding = false;
    }
  };

  askExample = (example: string) => {
    this.setQuestion(example);
    this.ask();
  };

  <template>
    <section class='vector-search'>
      <header>
        <h2>Search by meaning</h2>
        <p>
          Words rank as you type. Press Search to embed the question too: then
          moments close in meaning join, even with none of your words.
        </p>
      </header>

      <form class='ask' {{on 'submit' this.ask}}>
        <TextInput
          @value={{@model.question}}
          @onInput={{this.setQuestion}}
          placeholder='Ask about an idea…'
          aria-label='Question'
        />
        <Button @busy={{this.embedding}} type='submit'>Search</Button>
      </form>
      <div class='examples'>
        {{#each EXAMPLES as |example|}}
          <button
            type='button'
            class='example'
            {{on 'click' (fn this.askExample example)}}
          >{{example}}</button>
        {{/each}}
      </div>

      <SegmentedControl
        @options={{LENS_OPTIONS}}
        @value={{this.lens}}
        @onValueChange={{this.setLens}}
        @label='Rank by'
      />
      <p class='status' role='status'>
        {{#if this.embedding}}
          Embedding the question…
        {{else if this.vector}}
          Ranking by words and meaning.
        {{else if this.meaningDown}}
          Meaning is unavailable, so any of the words may match.
        {{else if this.question}}
          Ranking by words. Press Search to add meaning.
        {{else}}
          Most recommended first.
        {{/if}}
      </p>

      <ol class='results'>
        {{#each this.rows as |row|}}
          <li>
            {{#if row.similarity}}
              <span class='similarity'>{{percent row.similarity}}</span>
            {{/if}}
            {{#let (getComponent row.moment) as |Row|}}
              <Row @format='embedded' />
            {{/let}}
          </li>
        {{else}}
          <li class='empty'>No moments match.</li>
        {{/each}}
      </ol>

      <details>
        <summary>The query</summary>
        <pre>{{this.queryJSON}}</pre>
      </details>
    </section>
    <style scoped>
      .vector-search {
        padding: var(--boxel-sp-lg);
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--boxel-sp);
        max-width: 48rem;
      }
      header p,
      .status {
        margin: 0;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ask {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .ask > :first-child {
        flex: 1;
      }
      .examples {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .example {
        border: 1px solid var(--border, var(--boxel-300));
        background: none;
        border-radius: 999px;
        padding: 2px 10px;
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
      }
      .results {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .results li {
        display: flex;
        min-width: 0;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .similarity {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-sm);
        min-width: 3.5ch;
        text-align: right;
      }
      .empty {
        color: var(--muted-foreground, var(--boxel-450));
        padding: var(--boxel-sp-sm) 0;
      }
      pre {
        font-size: var(--boxel-font-size-xs);
        overflow: auto;
      }
    </style>
  </template>
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getComponent(card: CardDef) {
  return card.constructor.getComponent(card);
}

export class VectorSearchDemo extends CardDef {
  static displayName = 'Vector Search Demo';
  @field question = contains(StringField);
  @field lens = contains(StringField);
  static isolated = Isolated;
}
