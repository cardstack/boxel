// Pretui — MarkdownStream: assistant prose that arrives token by token, rendered so each update costs the tail, not the whole message. Finished blocks freeze and keep their DOM; only the last block re-renders; an open code fence grows by appending.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import type { SafeString } from '@ember/template';
import { modifier } from 'ember-modifier';
import { CodeBlock } from './code-block';
import { MarkdownSurface } from './markdown-surface';
import {
  collectDefinitions,
  heal,
  healBfm,
  isExternalHref,
  isPathLike,
  project,
  renderPlain,
} from '../internal/markdown-projection';
import type {
  BlockMode,
  Directive,
  MarkdownFlavor,
  ProjectedBlock,
  Projection,
} from '../internal/markdown-projection';

export type {
  Directive,
  MarkdownFlavor,
} from '../internal/markdown-projection';

/** What `@render` is asked to turn into HTML: one block's markdown. */
export interface MarkdownSource {
  /** stable across updates */
  key: string;
  /** the block's markdown, healed when it is the live tail */
  src: string;
  flavor: MarkdownFlavor;
  /** every link-reference and footnote definition in the whole document,
   * one per line, for a renderer to append: a block parsed on its own cannot
   * otherwise see a definition that lives in another block */
  definitions: string;
  mode: BlockMode;
}

/** A link `@resolveLink` confirmed. Anything else the caller needs to act
 * on it (a card id, a line range) rides in `target`. */
export interface ResolvedLink {
  href: string;
  kind: 'url' | 'path';
  target?: unknown;
}

export interface MarkdownCode {
  key: string;
  /** the block's position among the message's code blocks, from 0 */
  index: number;
  source: string;
  language?: string;
  /** whether the closing fence has arrived */
  complete: boolean;
}

export interface MarkdownDirective extends Directive {
  key: string;
}

/** A BFM card or file reference, inline (`:card[url]`) or block
 * (`::card[url | size]`). */
export interface MarkdownRef {
  /** stable while the reference's block is unchanged */
  key: string;
  type: 'card' | 'file';
  url: string;
  inline: boolean;
  /** block refs: the raw `|` arguments (format or size), for the host's own
   * parser. Inline refs: empty */
  args: string[];
  /** from the renderer's placeholder attributes, when it emitted them */
  format?: string;
  width?: string;
  height?: string;
  /** false while a block ref's closing `]` has not arrived: show a
   * placeholder, not a card */
  complete: boolean;
}

export interface MarkdownStreamSignature {
  Args: {
    /** the full accumulated text so far */
    text: string;
    /** true while tokens are still arriving */
    streaming?: boolean;
    /** block markdown → SANITIZED HTML, synchronously or as a promise. The
     * component inserts what this returns; sanitizing is the renderer's job.
     * Default: the text escaped into paragraphs. */
    render?: (source: MarkdownSource) => string | Promise<string>;
    /** repair the live tail's unclosed inline markup before rendering it.
     * Default true */
    heal?: boolean;
    /** a relative link or path-like inline code becomes a link only when
     * this confirms it. External http(s) links need no lookup. */
    resolveLink?: (
      href: string,
      kind: 'url' | 'path',
    ) => Promise<ResolvedLink | null | undefined>;
    /** a confirmed link was activated */
    onLinkActivate?: (
      link: ResolvedLink,
      event: MouseEvent | KeyboardEvent,
    ) => void;
    /** read politely once the stream completes. Silent by default */
    announceComplete?: string;
    /** 'markdown' (default) or 'bfm', Boxel Flavored Markdown: display math
     * stays one block and never renders half-written, partial card and file
     * references show as pending, an unclosed `$` stays literal, references
     * render through <:ref>, and finished Mermaid fences through <:diagram> */
    flavor?: MarkdownFlavor;
    /** bfm: fence languages that are diagrams. Default ['mermaid'] */
    diagramLanguages?: string[];
  };
  Blocks: {
    code: [MarkdownCode];
    directive: [MarkdownDirective];
    ref: [MarkdownRef];
    diagram: [MarkdownCode];
  };
  Element: HTMLDivElement;
}

interface RenderedEntry {
  /** the src the HTML on screen was rendered from */
  src: string;
  html: string;
  /** the request number the HTML on screen came from: a result from an
   * older request than this one is dropped */
  seq: number;
  /** reused while the HTML is unchanged, so Glimmer leaves the DOM (and any
   * selection in it) alone and the link scan does not re-run */
  safe?: SafeString;
  /** the src the newest pending promise was asked for, so the same src is
   * not requested twice */
  requested?: string;
}

interface ViewBlock {
  key: string;
  kind: ProjectedBlock['kind'];
  mode: BlockMode;
  html?: SafeString;
  code?: MarkdownCode;
  /** bfm: a finished diagram fence */
  diagram?: boolean;
  directive?: MarkdownDirective;
  /** bfm: a block card or file reference */
  ref?: MarkdownRef;
  /** bfm: display math still open; shown as its source, never rendered */
  pendingMath?: string;
  /** the streaming tail: the caret sits at the end of its text */
  caret?: boolean;
}

interface RefSlot {
  id: string;
  blockKey: string;
  element: Element;
  ref: MarkdownRef;
}

const REF_SELECTOR = '[data-boxel-bfm-inline-ref], [data-boxel-bfm-block-ref]';

function refFromPlaceholder(
  element: Element,
  key: string,
): MarkdownRef | undefined {
  let inlineUrl = element.getAttribute('data-boxel-bfm-inline-ref');
  let url = inlineUrl ?? element.getAttribute('data-boxel-bfm-block-ref');
  let type = element.getAttribute('data-boxel-bfm-type');
  if (!url || (type !== 'card' && type !== 'file')) {
    return undefined;
  }
  return {
    key,
    type,
    url,
    inline: inlineUrl !== null,
    args: [],
    format: element.getAttribute('data-boxel-bfm-format') ?? undefined,
    width: element.getAttribute('data-boxel-bfm-width') ?? undefined,
    height: element.getAttribute('data-boxel-bfm-height') ?? undefined,
    complete: true,
  };
}

const LINK_STATE = 'data-markdown-link';
const resolvedLinks = new WeakMap<Element, ResolvedLink>();

/** Runs `linkify` on insert and whenever the block's HTML changes. Keyed on
 * the HTML so an unchanged block is not re-scanned. */
const linkified = modifier(
  (
    element: HTMLElement,
    [linkify, _html, key]: [
      (el: HTMLElement, key: string) => void,
      SafeString | undefined,
      string,
    ],
  ) => {
    linkify(element, key);
  },
);

/** Both truthy: a template helper, since Glimmer has no `and`. */
const bothTrue = (a: unknown, b: unknown): boolean => Boolean(a) && Boolean(b);

// Node-type numbers rather than Node.TEXT_NODE: inside a realm module the
// name `Node` is not the browser's DOM Node, and its constants are absent.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function lastTextNode(node: Node): Text | null {
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    let child = node.childNodes[i]!;
    if (child.nodeType === TEXT_NODE) {
      if ((child.textContent ?? '').trim() !== '') {
        return child as Text;
      }
      continue;
    }
    if (child.nodeType === ELEMENT_NODE) {
      let found = lastTextNode(child);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** Puts the streaming caret right after the last word of the live block,
 * inside whatever element holds it (a paragraph, a list item, a cell), so it
 * reads as the end of the sentence rather than a line of its own. Re-placed
 * whenever the block's HTML changes; removed when the block freezes. */
const caretAtEnd = modifier(
  (
    element: HTMLElement,
    [_html, show]: [SafeString | undefined, boolean | undefined],
  ) => {
    element.querySelector('[data-markdown-caret]')?.remove();
    if (!show) {
      return;
    }
    let caret = document.createElement('span');
    caret.className = 'pretui-md-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.setAttribute('data-markdown-caret', '');
    caret.setAttribute('data-test-pretui-markdown-caret', '');
    // The block's HTML can land after this modifier installs, and an async
    // renderer swaps it later still, so the caret follows the content:
    // placed now, and re-placed whenever the block's children change.
    // Placing is idempotent, so its own move settles the observer.
    let place = () => {
      let text = lastTextNode(element);
      if (text) {
        if (text.nextSibling !== caret) {
          text.after(caret);
        }
      } else if (caret.parentNode !== element || element.lastChild !== caret) {
        element.appendChild(caret);
      }
    };
    place();
    let observer = new MutationObserver(place);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      caret.remove();
    };
  },
);

const listen = modifier(
  (
    element: HTMLElement,
    [onClick, onKeyDown]: [
      (event: MouseEvent) => void,
      (event: KeyboardEvent) => void,
    ],
  ) => {
    element.addEventListener('click', onClick);
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('click', onClick);
      element.removeEventListener('keydown', onKeyDown);
    };
  },
);

/**
 * Streaming markdown.
 *
 * ```hbs
 * <MarkdownStream @text={{message.body}} @streaming={{message.isStreaming}}
 *                 @render={{this.renderMarkdown}} @resolveLink={{this.resolve}}
 *                 @onLinkActivate={{this.open}}>
 *   <:directive as |d|><CardEmbed @url={{d.body}} @format={{get d.args 0}} /></:directive>
 * </MarkdownStream>
 * ```
 *
 * Better than re-rendering the whole message per token (what the current
 * host assistant does): frozen blocks call the renderer once, the live tail
 * is healed so half-written emphasis and links render as intended, and a
 * selection made mid-stream survives completion because a block whose HTML
 * does not change is not touched.
 */
export class MarkdownStream extends Component<MarkdownStreamSignature> {
  /** bumped when an async render resolves, so the view re-reads the cache */
  @tracked private version = 0;
  /** bfm references found in rendered blocks, each rendered in place
   * through <:ref> */
  @tracked refSlots: RefSlot[] = [];
  private projection: Projection | undefined;
  private rendered = new Map<string, RenderedEntry>();
  /** numbers each render request, so results apply in request order */
  private renderSeq = 0;

  get streaming(): boolean {
    return Boolean(this.args.streaming);
  }
  get flavor(): MarkdownFlavor {
    return this.args.flavor ?? 'markdown';
  }
  get isBfm(): boolean {
    return this.flavor === 'bfm';
  }
  private isDiagram(language: string | undefined): boolean {
    if (!this.isBfm || !language) {
      return false;
    }
    let languages = this.args.diagramLanguages ?? ['mermaid'];
    return languages.includes(language.toLowerCase());
  }

  get blocks(): ViewBlock[] {
    // consume the version so a resolved async render re-renders
    void this.version;
    let text = this.args.text ?? '';
    this.projection = project(
      this.projection,
      text,
      this.streaming,
      this.flavor,
    );
    let definitions = collectDefinitions(text);
    let live = new Set<string>();
    let codeIndex = 0;
    let view = this.projection.blocks.map((block): ViewBlock => {
      live.add(block.key);
      if (block.kind === 'code') {
        let index = codeIndex++;
        return {
          key: block.key,
          kind: 'code',
          mode: block.mode,
          code: {
            key: block.key,
            index,
            source: block.source ?? '',
            language: block.language,
            complete: Boolean(block.complete),
          },
          diagram: Boolean(block.complete) && this.isDiagram(block.language),
        };
      }
      if (block.kind === 'directive') {
        let directive = block.directive!;
        let isRef =
          this.isBfm &&
          (directive.name === 'card' || directive.name === 'file');
        return {
          key: block.key,
          kind: 'directive',
          mode: block.mode,
          directive: { key: block.key, ...directive },
          ref: isRef
            ? {
                key: block.key,
                type: directive.name as 'card' | 'file',
                url: directive.body,
                inline: false,
                args: directive.args,
                complete: directive.complete,
              }
            : undefined,
        };
      }
      if (block.pendingMath) {
        return {
          key: block.key,
          kind: 'text',
          mode: block.mode,
          pendingMath: block.raw,
        };
      }
      let src = block.raw;
      if (block.mode === 'live' && (this.args.heal ?? true)) {
        src = heal(this.isBfm ? healBfm(src) : src);
      }
      return {
        key: block.key,
        kind: 'text',
        mode: block.mode,
        caret: block.mode === 'live',
        html: this.safeFor(
          block.key,
          this.htmlFor(block.key, src, block.mode, definitions),
        ),
      };
    });
    // forget blocks that no longer exist (a reset, a regenerate)
    for (let key of this.rendered.keys()) {
      if (!live.has(key)) {
        this.rendered.delete(key);
      }
    }
    return view;
  }

  /** The block's HTML, rendering only when its source changed. An async
   * renderer keeps the previous HTML on screen until a result lands. Every
   * request is numbered, and a result replaces the HTML on screen whenever
   * it comes from a newer request than that HTML did, even when a still
   * newer request is pending: under a steady stream with a slow renderer,
   * the tail then advances with each result instead of waiting for the
   * stream to pause. A result older than the HTML on screen is dropped. */
  private htmlFor(
    key: string,
    blockSrc: string,
    mode: BlockMode,
    definitions: string,
  ): string {
    // the cache is keyed on what the renderer sees: a definition added later
    // in the document re-renders the blocks that could use it
    let src = definitions ? `${blockSrc}\u0000${definitions}` : blockSrc;
    let entry = this.rendered.get(key);
    if (entry && entry.src === src) {
      return entry.html;
    }
    if (entry && entry.requested === src) {
      return entry.html;
    }
    let render = this.args.render;
    let seq = ++this.renderSeq;
    if (!render) {
      let html = renderPlain(blockSrc);
      this.rendered.set(key, { src, html, seq });
      return html;
    }
    let result = render({
      key,
      src: blockSrc,
      mode,
      flavor: this.flavor,
      definitions,
    });
    if (typeof result === 'string') {
      this.rendered.set(key, { src, html: result, seq });
      return result;
    }
    let previous = entry?.html ?? '';
    this.rendered.set(key, {
      src: entry?.src ?? '',
      html: previous,
      seq: entry?.seq ?? 0,
      safe: entry?.safe,
      requested: src,
    });
    let land = (html: string) => {
      let current = this.rendered.get(key);
      if (!current || seq <= current.seq || this.isDestroyed) {
        return; // the block is gone, or newer HTML is already on screen
      }
      this.rendered.set(key, {
        src,
        html,
        seq,
        safe: current.safe,
        // a newer request still pending stays pending
        requested: current.requested === src ? undefined : current.requested,
      });
      this.version++;
    };
    result.then(land, () => land(renderPlain(blockSrc)));
    return previous;
  }

  private safeFor(key: string, html: string): SafeString {
    let entry = this.rendered.get(key);
    if (entry?.safe && entry.safe.toString() === html) {
      return entry.safe;
    }
    let safe = htmlSafe(html);
    if (entry) {
      entry.safe = safe;
    }
    return safe;
  }

  get announcement(): string {
    return this.streaming ? '' : (this.args.announceComplete ?? '');
  }

  // ── links ──────────────────────────────────────────────────────────────

  /** Runs whenever a text block's HTML is (re)inserted: marks external
   * links to open in a new tab, and asks @resolveLink about relative links
   * and path-like inline code. Unconfirmed, they stay plain text. */
  linkify = (element: HTMLElement, blockKey: string) => {
    if (this.isBfm) {
      this.collectRefs(element, blockKey);
    }
    for (let anchor of Array.from(element.querySelectorAll('a[href]'))) {
      let href = anchor.getAttribute('href') ?? '';
      if (isExternalHref(href)) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        continue;
      }
      this.pend(anchor, href, 'url');
    }
    for (let code of Array.from(element.querySelectorAll('code'))) {
      if (code.closest('pre')) {
        continue;
      }
      let text = code.textContent ?? '';
      if (isPathLike(text)) {
        this.pend(code, text.trim(), 'path');
      }
    }
  };

  /** Register the block's reference placeholders as slots. Deferred past
   * the render that inserted them: refSlots was read in that render. */
  private collectRefs(element: HTMLElement, blockKey: string) {
    let found: RefSlot[] = [];
    Array.from(element.querySelectorAll(REF_SELECTOR)).forEach(
      (placeholder, index) => {
        let id = `${blockKey}#${index}`;
        let ref = refFromPlaceholder(placeholder, id);
        if (ref) {
          found.push({ id, blockKey, element: placeholder, ref });
        }
      },
    );
    // refSlots is read only inside the microtask: reading it here would make
    // this modifier depend on it, and the write below would re-run the
    // modifier forever
    queueMicrotask(() => {
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      let hadAny = this.refSlots.some((slot) => slot.blockKey === blockKey);
      if (!found.length && !hadAny) {
        return;
      }
      this.refSlots = [
        ...this.refSlots.filter(
          (slot) => slot.blockKey !== blockKey && slot.element.isConnected,
        ),
        ...found,
      ];
    });
  }

  private pend(el: Element, href: string, kind: 'url' | 'path') {
    let resolve = this.args.resolveLink;
    el.setAttribute(LINK_STATE, 'pending');
    if (!resolve) {
      return;
    }
    resolve(href, kind).then(
      (link) => {
        if (!link || !el.isConnected) {
          return;
        }
        resolvedLinks.set(el, link);
        el.setAttribute(LINK_STATE, 'resolved');
        if (el.tagName !== 'A') {
          el.setAttribute('role', 'link');
          el.setAttribute('tabindex', '0');
        }
      },
      () => undefined,
    );
  }

  private activate(event: MouseEvent | KeyboardEvent) {
    let target = event.target instanceof Element ? event.target : null;
    let el = target?.closest(`[${LINK_STATE}]`);
    if (!el) {
      return;
    }
    if (el.getAttribute(LINK_STATE) !== 'resolved') {
      // an unconfirmed relative link goes nowhere
      event.preventDefault();
      return;
    }
    let link = resolvedLinks.get(el);
    if (link) {
      event.preventDefault();
      this.args.onLinkActivate?.(link, event);
    }
  }

  onClick = (event: MouseEvent) => this.activate(event);
  onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      this.activate(event);
    }
  };

  <template>
    <div
      class='pretui-md'
      aria-busy={{if this.streaming 'true'}}
      data-streaming={{if this.streaming 'true' 'false'}}
      {{listen this.onClick this.onKeyDown}}
      data-test-pretui-markdown-stream
      ...attributes
    >
      <MarkdownSurface class='pretui-md-prose'>
        {{#each this.blocks key='key' as |block|}}
          {{#if block.code}}
            <div
              class='pretui-md-block'
              data-scroll-anchor
              data-kind='code'
              data-mode={{block.mode}}
              data-complete={{if block.code.complete 'true' 'false'}}
              data-test-pretui-markdown-block='code'
            >
              {{#if (bothTrue block.diagram (has-block 'diagram'))}}
                {{yield block.code to='diagram'}}
              {{else if (has-block 'code')}}
                {{yield block.code to='code'}}
              {{else}}
                <CodeBlock
                  @code={{block.code.source}}
                  @language={{block.code.language}}
                  @maxLines={{24}}
                  data-scroll-region
                />
              {{/if}}
            </div>
          {{else if block.directive}}
            <div
              class='pretui-md-block'
              data-scroll-anchor
              data-kind='directive'
              data-mode={{block.mode}}
              data-test-pretui-markdown-block='directive'
            >
              {{#if (bothTrue block.ref (has-block 'ref'))}}
                {{yield block.ref to='ref'}}
              {{else if (has-block 'directive')}}
                {{yield block.directive to='directive'}}
              {{else}}
                <p>::{{block.directive.name}}[{{block.directive.body}}]</p>
              {{/if}}
            </div>
          {{else if block.pendingMath}}
            <div
              class='pretui-md-block'
              data-scroll-anchor
              data-kind='text'
              data-mode={{block.mode}}
              data-test-pretui-markdown-block='text'
            ><pre
                class='pretui-md-math-pending'
                data-pending-math
                data-test-pretui-markdown-pending-math
              >{{block.pendingMath}}</pre></div>
          {{else}}
            <div
              class='pretui-md-block'
              data-scroll-anchor
              data-kind='text'
              data-mode={{block.mode}}
              {{linkified this.linkify block.html block.key}}
              {{caretAtEnd block.html block.caret}}
              data-test-pretui-markdown-block='text'
            >{{block.html}}</div>
          {{/if}}
        {{/each}}
        {{#if (has-block 'ref')}}
          {{#each this.refSlots key='id' as |slot|}}
            {{#in-element slot.element}}
              {{yield slot.ref to='ref'}}
            {{/in-element}}
          {{/each}}
        {{/if}}
      </MarkdownSurface>
      <span
        class='pretui-md-live'
        role='status'
        aria-live='polite'
        data-test-pretui-markdown-announce
      >{{this.announcement}}</span>
    </div>
    <style scoped>
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* the answer's typography is MarkdownSurface's: the reading voice,
           the heading ladder, code and tables; this keeps the blocks' own
           rhythm and the stream's marks */
        .pretui-md {
          min-width: 0;
        }
        .pretui-md-block {
          min-width: 0;
        }
        /* Each block wraps the HTML its renderer returned and adds no
           spacing of its own: the block has no padding or border, so its
           children's margins collapse through it and Prose's margins
           between paragraphs and around headings hold exactly as in a
           static render. Prose zeroes the outer edges of its own first and
           last child, which here are blocks, so the same edges are zeroed
           one level down. */
        .pretui-md-block:first-child > :deep(:first-child) {
          margin-block-start: 0;
        }
        .pretui-md-block:last-child > :deep(:last-child) {
          margin-block-end: 0;
        }
        .pretui-md-block[data-kind='code'] {
          margin-block: var(--boxel-sp-sm);
        }
        .pretui-md-block[data-kind='code']:first-child {
          margin-block-start: 0;
        }
        .pretui-md-block[data-kind='code']:last-child {
          margin-block-end: 0;
        }
        /* an unconfirmed relative link reads as the plain text it is */
        .pretui-md-block :deep([data-markdown-link='pending']) {
          color: inherit;
          text-decoration: none;
          cursor: text;
        }
        .pretui-md-block :deep(code[data-markdown-link='resolved']) {
          cursor: pointer;
          text-decoration: underline;
          text-decoration-color: var(--muted-foreground);
          text-underline-offset: 0.18em;
        }
        .pretui-md-block
          :deep(code[data-markdown-link='resolved']:focus-visible) {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-md-block :deep(.pretui-md-caret) {
          display: inline-block;
          width: 0.5em;
          height: 1em;
          margin-inline-start: var(--boxel-sp-6xs);
          vertical-align: text-bottom;
          border-radius: var(--boxel-border-radius-2xs);
          background-color: color-mix(in oklch, var(--foreground) 60%, transparent);
          animation: pretui-md-caret 1s steps(2, start) infinite;
        }
        @keyframes pretui-md-caret {
          to {
            visibility: hidden;
          }
        }
        /* math still arriving is its source, a pasteable string, in the
           quieter ink rather than faded */
        .pretui-md-math-pending {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          color: var(--muted-foreground);
        }
        .pretui-md-live {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-md-block :deep(.pretui-md-caret) {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
