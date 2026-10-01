// Pretui — Typography: the prose atoms — Title, Text, Paragraph, Code, Blockquote and Link — as real semantic tags.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { VisuallyHidden } from './visually-hidden';

// Every atom renders the element its name promises: a Title is an h1–h6, a
// Paragraph a <p>, a Link an <a href>. Styled divs that look like headings are
// the failure these exist to prevent — a screen reader navigates by the tags.
// Machine values (ids, hashes, paths) go through Token (Law 3), not Code; Code
// is for a fragment of source in running prose. Prose is the region that
// styles a whole block of rendered markdown.

export type TextTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';
export type TextSize = 'xs' | 'sm' | 'md' | 'lg';

const TONES: readonly TextTone[] = ['default', 'muted', 'success', 'warning', 'danger'];
const SIZES: readonly TextSize[] = ['xs', 'sm', 'md', 'lg'];

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// ── Title ────────────────────────────────────────────────────────────────

export interface TitleSignature {
  Args: {
    /** The heading level, 1–6 (default 2). It is the document outline, so pick it for structure. */
    level?: 1 | 2 | 3 | 4 | 5 | 6;
    /** The visual size, when it must differ from the level: 'display' | 'heading' | 'subheading'. */
    size?: 'display' | 'heading' | 'subheading';
  };
  Blocks: { default: [] };
  Element: HTMLHeadingElement;
}

export class Title extends Component<TitleSignature> {
  get level(): number {
    let level = this.args.level ?? 2;
    return level >= 1 && level <= 6 ? level : 2;
  }
  get size(): string {
    return this.args.size ?? (this.level === 1 ? 'display' : this.level <= 3 ? 'heading' : 'subheading');
  }
  get h1() {
    return this.level === 1;
  }
  get h2() {
    return this.level === 2;
  }
  get h3() {
    return this.level === 3;
  }
  get h4() {
    return this.level === 4;
  }
  get h5() {
    return this.level === 5;
  }
  <template>
    {{#if this.h1}}
      <h1 class='pretui-title' data-size={{this.size}} data-test-pretui-title ...attributes>{{yield}}</h1>
    {{else if this.h2}}
      <h2 class='pretui-title' data-size={{this.size}} data-test-pretui-title ...attributes>{{yield}}</h2>
    {{else if this.h3}}
      <h3 class='pretui-title' data-size={{this.size}} data-test-pretui-title ...attributes>{{yield}}</h3>
    {{else if this.h4}}
      <h4 class='pretui-title' data-size={{this.size}} data-test-pretui-title ...attributes>{{yield}}</h4>
    {{else if this.h5}}
      <h5 class='pretui-title' data-size={{this.size}} data-test-pretui-title ...attributes>{{yield}}</h5>
    {{else}}
      <h6 class='pretui-title' data-size={{this.size}} data-test-pretui-title ...attributes>{{yield}}</h6>
    {{/if}}
    <style scoped>
      .pretui-title {
        margin: 0;
        font-family: var(--font-serif);
        font-weight: var(--weight-heading, 500);
        letter-spacing: var(--track-heading, -0.01em);
        line-height: var(--leading-heading, 1.2);
        color: var(--foreground);
        text-wrap: balance;
      }
      .pretui-title[data-size='display'] {
        font-size: var(--text-display, 2rem);
      }
      .pretui-title[data-size='heading'] {
        font-size: var(--text-heading, 1.1875rem);
      }
      .pretui-title[data-size='subheading'] {
        font-family: var(--font-sans);
        font-size: var(--text-ui-lg, 0.9375rem);
        font-weight: var(--weight-strong, 600);
        letter-spacing: 0;
      }
    </style>
  </template>
}

// ── Text and Paragraph ───────────────────────────────────────────────────

export interface TextSignature {
  Args: {
    /** Default 'default'. `muted` is the secondary line; the rest are status inks. */
    tone?: TextTone;
    size?: TextSize;
    /** Semantic emphasis, as <strong>. */
    strong?: boolean;
    /** Highlighted, as <mark> — a search hit, a changed value. */
    mark?: boolean;
    /** No longer true, as <s>. */
    strike?: boolean;
    /** Stress emphasis, as <em>. */
    italic?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

// The inner tags carry the meaning; the outer span carries tone and size.
export class Text extends Component<TextSignature> {
  get tone(): TextTone {
    return pick(this.args.tone, TONES, 'default');
  }
  get size(): TextSize | undefined {
    return this.args.size ? pick(this.args.size, SIZES, 'md') : undefined;
  }
  <template>
    <span class='pretui-text' data-tone={{this.tone}} data-size={{this.size}} data-test-pretui-text ...attributes>
      {{#if @strong}}
        <strong>{{#if @italic}}<em>{{#if @mark}}<mark>{{yield}}</mark>{{else if @strike}}<s>{{yield}}</s>{{else}}{{yield}}{{/if}}</em>{{else if @mark}}<mark>{{yield}}</mark>{{else if @strike}}<s>{{yield}}</s>{{else}}{{yield}}{{/if}}</strong>
      {{else if @italic}}
        <em>{{#if @mark}}<mark>{{yield}}</mark>{{else if @strike}}<s>{{yield}}</s>{{else}}{{yield}}{{/if}}</em>
      {{else if @mark}}
        <mark>{{yield}}</mark>
      {{else if @strike}}
        <s>{{yield}}</s>
      {{else}}
        {{yield}}
      {{/if}}
    </span>
    <style scoped>
      .pretui-text[data-tone='muted'] {
        color: var(--muted-foreground);
      }
      .pretui-text[data-tone='success'] {
        color: color-mix(in oklch, var(--foreground) 30%, var(--success));
      }
      .pretui-text[data-tone='warning'] {
        color: color-mix(in oklch, var(--foreground) 45%, var(--warning));
      }
      .pretui-text[data-tone='danger'] {
        color: color-mix(in oklch, var(--foreground) 25%, var(--destructive));
      }
      .pretui-text[data-size='xs'] {
        font-size: var(--text-ui-xs, 0.66rem);
      }
      .pretui-text[data-size='sm'] {
        font-size: var(--text-ui-sm, 0.72rem);
      }
      .pretui-text[data-size='md'] {
        font-size: var(--text-ui-md, 0.78rem);
      }
      .pretui-text[data-size='lg'] {
        font-size: var(--text-ui-lg, 0.9375rem);
      }
      .pretui-text mark {
        padding-inline: 0.125em;
        border-radius: 0.2em;
        color: inherit;
        background: color-mix(in oklch, var(--pretui-text-mark, var(--warning)) 35%, transparent);
      }
      .pretui-text strong {
        font-weight: var(--weight-strong, 600);
      }
    </style>
  </template>
}

export interface ParagraphSignature {
  Args: {
    tone?: TextTone;
    size?: TextSize;
  };
  Blocks: { default: [] };
  Element: HTMLParagraphElement;
}

export class Paragraph extends Component<ParagraphSignature> {
  get tone(): TextTone {
    return pick(this.args.tone, TONES, 'default');
  }
  get size(): TextSize | undefined {
    return this.args.size ? pick(this.args.size, SIZES, 'md') : undefined;
  }
  <template>
    <p class='pretui-paragraph' data-tone={{this.tone}} data-size={{this.size}} data-test-pretui-paragraph ...attributes>{{yield}}</p>
    <style scoped>
      .pretui-paragraph {
        margin: 0;
        max-inline-size: var(--pretui-paragraph-measure, 68ch);
        font-size: var(--text-body, 0.875rem);
        line-height: var(--leading-body, 1.55);
        color: var(--foreground);
        text-wrap: pretty;
      }
      .pretui-paragraph[data-tone='muted'] {
        color: var(--muted-foreground);
      }
      .pretui-paragraph[data-tone='success'] {
        color: color-mix(in oklch, var(--foreground) 30%, var(--success));
      }
      .pretui-paragraph[data-tone='warning'] {
        color: color-mix(in oklch, var(--foreground) 45%, var(--warning));
      }
      .pretui-paragraph[data-tone='danger'] {
        color: color-mix(in oklch, var(--foreground) 25%, var(--destructive));
      }
      .pretui-paragraph[data-size='xs'] {
        font-size: var(--text-ui-xs, 0.66rem);
      }
      .pretui-paragraph[data-size='sm'] {
        font-size: var(--text-ui-sm, 0.72rem);
      }
      .pretui-paragraph[data-size='md'] {
        font-size: var(--text-ui-md, 0.78rem);
      }
      .pretui-paragraph[data-size='lg'] {
        font-size: var(--text-ui-lg, 0.9375rem);
      }
    </style>
  </template>
}

// ── Code ─────────────────────────────────────────────────────────────────

export interface CodeSignature {
  Blocks: { default: [] };
  Element: HTMLElement;
}

/** A fragment of source in running prose. A block of code is CodeBlock. */
export const Code: TemplateOnlyComponent<CodeSignature> = <template>
  <code class='pretui-code' data-test-pretui-code ...attributes>{{yield}}</code>
  <style scoped>
    .pretui-code {
      padding: 0.1em 0.35em;
      border-radius: var(--radius-control, 6px);
      background: color-mix(in oklch, var(--foreground) 7%, var(--card));
      font-family: var(--font-mono);
      font-size: 0.9em;
      overflow-wrap: anywhere;
    }
  </style>
</template>;

// ── Blockquote ───────────────────────────────────────────────────────────

export interface BlockquoteSignature {
  Args: {
    /** Who said it. Rendered as the quote's caption. */
    attribution?: string;
    /** The source URL, as the blockquote's cite attribute. */
    cite?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

/** A <blockquote> in a <figure>, so the attribution is the quote's caption rather than loose text after it. */
export const Blockquote: TemplateOnlyComponent<BlockquoteSignature> = <template>
  <figure class='pretui-quote' data-test-pretui-blockquote ...attributes>
    <blockquote class='pretui-quote-body' cite={{@cite}}>{{yield}}</blockquote>
    {{#if @attribution}}
      <figcaption class='pretui-quote-by'>— {{@attribution}}</figcaption>
    {{/if}}
  </figure>
  <style scoped>
    .pretui-quote {
      margin: 0;
      padding-inline-start: var(--space-4, 0.6875rem);
      border-inline-start: 3px solid var(--pretui-quote-rule, var(--border));
    }
    .pretui-quote-body {
      margin: 0;
      font-family: var(--font-serif);
      font-size: var(--text-body, 0.875rem);
      line-height: var(--leading-body, 1.55);
      color: var(--foreground);
    }
    .pretui-quote-by {
      margin-block-start: var(--space-2, 0.375rem);
      font-size: var(--text-ui-sm, 0.72rem);
      color: var(--muted-foreground);
    }
  </style>
</template>;

// ── Link ─────────────────────────────────────────────────────────────────

export interface LinkSignature {
  Args: {
    href: string;
    /** Open in a new tab, with rel=noopener and a spoken "(opens in a new tab)". */
    external?: boolean;
    /** Default 'inline' (underlined in prose); 'quiet' underlines on hover only. */
    variant?: 'inline' | 'quiet';
  };
  Blocks: { default: [] };
  Element: HTMLAnchorElement;
}

export class Link extends Component<LinkSignature> {
  get variant(): string {
    return this.args.variant === 'quiet' ? 'quiet' : 'inline';
  }
  <template>
    <a
      class='pretui-link'
      href={{@href}}
      target={{if @external '_blank'}}
      rel={{if @external 'noopener noreferrer'}}
      data-variant={{this.variant}}
      data-test-pretui-link
      ...attributes
    >{{yield}}{{#if @external}}<span class='pretui-link-ext' aria-hidden='true'>↗</span><VisuallyHidden>
          (opens in a new tab)</VisuallyHidden>{{/if}}</a>
    <style scoped>
      .pretui-link {
        color: var(--pretui-link-ink, var(--primary));
        text-decoration-line: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 0.18em;
        border-radius: 2px;
      }
      .pretui-link[data-variant='quiet'] {
        text-decoration-line: none;
      }
      .pretui-link:hover {
        text-decoration-line: underline;
        text-decoration-thickness: 2px;
      }
      .pretui-link:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-link-ext {
        margin-inline-start: 0.15em;
        font-size: 0.85em;
      }
    </style>
  </template>
}

// ── Typography ───────────────────────────────────────────────────────────

/**
 * The namespace React agents type — `<Typography.Title>`, `<Typography.Text>`.
 * Each atom is also exported on its own.
 */
export const Typography = {
  Title,
  Text,
  Paragraph,
  Code,
  Blockquote,
  Link,
};
