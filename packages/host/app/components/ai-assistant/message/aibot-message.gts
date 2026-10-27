import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { MarkdownStream } from '@cardstack/pretui/components/markdown-stream';
import { MarkdownSurface } from '@cardstack/pretui/components/markdown-surface';
import { Thinking } from '@cardstack/pretui/components/thinking';
import { modifier } from 'ember-modifier';

import { and, eq } from '@cardstack/boxel-ui/helpers';

import { escapeHtmlOutsideCodeBlocks } from '@cardstack/runtime-common/helpers/html';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

import CodeBlock from '@cardstack/host/components/ai-assistant/code-block';
import RenderedMarkdown from '@cardstack/host/components/operator-mode/preview-panel/rendered-markdown';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

import type {
  HtmlPreTagGroup,
  CodeData,
} from '@cardstack/host/lib/formatted-message/utils';
import {
  type HtmlTagGroup,
  wrapLastTextNodeInStreamingTextSpan,
} from '@cardstack/host/lib/formatted-message/utils';
import {
  cardRefLabel,
  markReplyFurniture,
} from '@cardstack/host/lib/reply-furniture';

import type AssistantQuickLookService from '@cardstack/host/services/assistant-quick-look';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type RealmService from '@cardstack/host/services/realm';

import AnswerCard from '../answer-card';

import Message from './text-content';

import type {
  MarkdownCode,
  MarkdownSource,
} from '@cardstack/pretui/components/markdown-stream';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    htmlParts?: HtmlTagGroup[];
    /** the markdown as written; when present it is rendered block by block
     * as it streams, and htmlParts is not used */
    body?: string;
    isCanceled?: boolean;
    roomId: string;
    eventId: string;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    reasoning?: {
      content: string | null;
      isExpanded: boolean;
      setExpanded: (expanded: boolean) => void;
      isWorking: boolean;
      /** within a turn: 'tail' while it works (one line, the reasoning's own
       * heading), 'shown' once the reader opened the turn's thinking; outside
       * a turn, the closed trace */
      mode?: 'tail' | 'hidden' | 'shown';
    };
  };
  Blocks: {
    default: [];
  };
}

const HTTP_HREF = new RegExp('^https?:', 'i');

// Marks the reply's answer furniture (stat chips, source refs, a sources
// strip, a Method disclosure) whenever its markup changes.
const markFurniture = modifier((element: HTMLElement) => {
  markReplyFurniture(element);
  let observer = new MutationObserver(() => markReplyFurniture(element));
  observer.observe(element, { childList: true, subtree: true });
  return () => observer.disconnect();
});

export default class FormattedAiBotMessage extends Component<Signature> {
  private furniture = markFurniture;

  @service declare private realm: RealmService;
  @service('assistant-quick-look')
  declare private quickLook: AssistantQuickLookService;

  // the beacons this reply's cards and files publish: `ql:<event>:<id>`
  private get lookKeyPrefix() {
    return `ql:${this.args.eventId}`;
  }

  // A card or file the reply names opens in Quick Look first, over the
  // transcript, with a way to open it properly. A link or a control inside
  // the card keeps its own click.
  private openReferencedCard = (event: Event) => {
    let target = event.target as HTMLElement | null;
    if (
      target?.closest('a, button, input, select, textarea, [role="button"]')
    ) {
      return;
    }
    let slot = target?.closest<HTMLElement>('[data-card-ref]');
    if (slot) {
      this.look(slot, event);
    }
  };

  // A link in the reply never takes the app's place: one to a card or a
  // file in a realm opens in Quick Look, over the transcript; any other
  // opens in a new window. A modified click is the reader's own choice.
  private openLink = (event: Event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    let target = event.target instanceof Element ? event.target : null;
    let anchor = target?.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.closest('[data-card-ref]')) {
      return;
    }
    let href = anchor.href;
    if (!HTTP_HREF.test(href)) {
      return;
    }
    event.preventDefault();
    if (!this.realm.url(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    // a card's URL names no file (or its .json); anything else is a file
    let { pathname } = new URL(href);
    let isCard = !FILE_EXTENSION.test(pathname) || pathname.endsWith('.json');
    let id = isCard ? href.replace(/\.json$/, '') : href;
    this.quickLook.open({
      kind: isCard ? 'card' : 'file',
      id,
      sourceKey: `${this.lookKeyPrefix}:${id}`,
      trigger: anchor,
    });
  };

  // Space or Enter on a focused card or file opens it too; a key pressed
  // inside the card's own controls is the card's.
  private lookFromKeyboard = (event: Event) => {
    let key = (event as KeyboardEvent).key;
    if (key !== ' ' && key !== 'Enter') {
      return;
    }
    let target = event.target as HTMLElement | null;
    if (target?.hasAttribute('data-card-ref')) {
      this.look(target, event);
    }
  };

  private look(slot: HTMLElement, event: Event) {
    let id = slot.dataset.cardRef;
    if (!id) {
      return;
    }
    event.preventDefault();
    this.quickLook.open({
      kind: slot.dataset.cardRefKind === 'file' ? 'file' : 'card',
      id,
      sourceKey: `${this.lookKeyPrefix}:${id}`,
      trigger: slot,
    });
  }

  // The reply's words, or nothing when a part of the turn carries only its
  // thinking or its calls: an empty body would still take a block's space
  private get bodyText(): string | undefined {
    let body = this.args.body;
    if (typeof body !== 'string') {
      return undefined;
    }
    return body.trim() || this.args.isStreaming ? body : undefined;
  }

  @cached
  // A reply that was cancelled says so in words, as Pret UI's AgentTurn
  // says a stopped turn: what it kept, never a raw marker.
  private get stoppedLine() {
    return this.args.body?.trim()
      ? '■ Stopped · partial answer kept'
      : '■ Stopped before it answered';
  }

  // The reasoning's latest heading ("Updating relationships safely"), or
  // its latest line: what the work is about right now, in its own words
  private get reasoningHeading(): string | undefined {
    let content = this.args.reasoning?.content;
    if (!content || content === 'Thinking...') {
      return undefined;
    }
    let lines = content
      .split('\n')
      .map((line) => line.replace(/^#+\s*|\*\*/g, '').trim())
      .filter(Boolean);
    let heading = [...content.split('\n')]
      .reverse()
      .find((line) => /^\s*(#+\s|\*\*[^*]+\*\*\s*$)/.test(line));
    let text = heading ? heading.replace(/^#+\s*|\*\*/g, '').trim() : lines[0];
    return text && text.length > 90 ? `${text.slice(0, 89)}…` : text;
  }

  private get reasoningHtml() {
    // `markdownToHtml()` already sanitizes by default, so this only needs to
    // mark that sanitized result as renderable HTML.
    return htmlSafe(markdownToHtml(this.args.reasoning?.content));
  }

  // One block of the bot's markdown → sanitized HTML, through the same
  // pipeline the whole message used to take (escape raw HTML outside code,
  // then marked with sanitizing). Link-reference definitions from elsewhere
  // in the message ride along so a block can resolve them; footnote
  // definitions do not, since marked would render a footnote list per block.
  private renderMarkdownBlock = (source: MarkdownSource): string => {
    let definitions = source.definitions
      .split('\n')
      .filter((line) => line && !line.trimStart().startsWith('[^'))
      .join('\n');
    let markdown = definitions ? `${source.src}\n\n${definitions}` : source.src;
    // a reference still arriving (no closing bracket yet) is held back
    // rather than shown as markup
    markdown = markdown.replace(PARTIAL_CARD_REF, '');
    return namedCardRefs(
      markdownToHtml(escapeHtmlOutsideCodeBlocks(markdown) ?? '', {
        sanitize: true,
        escapeHtmlInCodeBlocks: true,
      }),
    );
  };

  // While a reply streams, MarkdownStream renders it block by block; card
  // references show once the reply is complete, when they can be loaded and
  // laid out without moving the text around them.
  private get rendersCardRefs() {
    let body = this.args.body;
    return (
      typeof body === 'string' && !this.args.isStreaming && CARD_REF.test(body)
    );
  }

  private codeDataFor = (code: MarkdownCode): CodeData => ({
    code: code.source,
    language: code.language ?? 'text',
    roomId: this.args.roomId,
    eventId: this.args.eventId,
    codeBlockIndex: code.index,
  });

  private isLastHtmlGroup = (index: number) => {
    return index === (this.args.htmlParts?.length ?? 0) - 1;
  };

  private preTagGroupIndex = (htmlPartIndex: number) => {
    return this.args
      .htmlParts!.slice(0, htmlPartIndex)
      .filter(isHtmlPreTagGroup).length;
  };

  <template>
    <Message
      class='ai-bot-message'
      {{this.furniture}}
      {{on 'click' this.openLink}}
    >
      {{#if (eq @reasoning.mode 'tail')}}
        {{! the work under way, said in the reasoning's own words; the cap
            by the message box says that it is thinking }}
        {{#if this.reasoningHeading}}
          <p class='reasoning-tail' data-test-reasoning-tail>
            {{this.reasoningHeading}}
          </p>
        {{/if}}
      {{else if (eq @reasoning.mode 'shown')}}
        {{#unless (eq 'Thinking...' @reasoning.content)}}
          <div class='reasoning-shown' data-test-reasoning-shown>
            {{this.reasoningHtml}}
          </div>
        {{/unless}}
      {{else if @reasoning}}
        {{! The reasoning trace, closed by default. "Thinking..." is the
            placeholder the bot sends before any reasoning text exists. }}
        <Thinking
          class='reasoning-content'
          @label='Thinking'
          @doneLabel='Thought'
          @working={{@reasoning.isWorking}}
          @expanded={{@reasoning.isExpanded}}
          @onExpandedChange={{@reasoning.setExpanded}}
          data-test-reasoning
        >
          {{#unless (eq 'Thinking...' @reasoning.content)}}
            <div class='reasoning-body' data-test-reasoning-body>
              {{this.reasoningHtml}}
            </div>
          {{/unless}}
        </Thinking>
      {{/if}}
      {{! We are splitting the html into parts so that we can target the
      code blocks (<pre> tags) and apply Monaco editor to them. Here is an
      example of the html argument:

      <p>Here is some code for you.</p>
      <pre data-codeblock="javascript">const x = 1;</pre>
      <p>I hope you like this code. But here is some more!</p>
      <pre data-codeblock="javascript">const y = 2;</pre>
      <p>Feel free to use it in your project.</p>

      A drawback of this approach is that we can't render monaco editors for
      code blocks that are nested inside other elements. We should make sure
      our skills teach the model to respond with code blocks that are not nested
      inside other elements.
      }}
      {{#if this.rendersCardRefs}}
        {{! A finished reply that names cards with rich markdown (:card[url]
            pills, ::card[url | fitted] and ::card[url | embedded] blocks)
            renders through the host's markdown renderer, which loads each
            card and sizes it; a click, or Space or Enter on a focused one, opens
            it in Quick Look. }}
        {{! template-lint-disable no-invalid-interactive }}
        <MarkdownSurface
          class='bfm-reply'
          {{on 'click' this.openReferencedCard}}
          {{on 'keydown' this.lookFromKeyboard}}
          data-test-ai-bot-bfm
        >
          <RenderedMarkdown
            @content={{@body}}
            @lookKeyPrefix={{this.lookKeyPrefix}}
            @blockCard={{AnswerCard}}
            @loadingLabels={{true}}
          />
        </MarkdownSurface>
        {{#if @isCanceled}}
          <p
            class='generation-cancelled'
            data-test-generation-stopped
          >{{this.stoppedLine}}</p>
        {{/if}}
      {{else if this.bodyText}}
        <MarkdownStream
          @text={{this.bodyText}}
          @streaming={{@isStreaming}}
          @flavor='bfm'
          @render={{this.renderMarkdownBlock}}
          data-test-ai-bot-markdown
        >
          <:code as |code|>
            <HtmlGroupCodeBlock
              @codeData={{this.codeDataFor code}}
              @monacoSDK={{@monacoSDK}}
              @index={{code.index}}
            />
          </:code>
        </MarkdownStream>
        {{#if @isCanceled}}
          <p
            class='generation-cancelled'
            data-test-generation-stopped
          >{{this.stoppedLine}}</p>
        {{/if}}
      {{else}}
        {{#each @htmlParts key='@index' as |htmlPart index|}}
          {{#if (isHtmlPreTagGroup htmlPart)}}
            <HtmlGroupCodeBlock
              @codeData={{htmlPart.codeData}}
              @monacoSDK={{@monacoSDK}}
              @index={{this.preTagGroupIndex index}}
            />
          {{else}}
            {{#if (and @isStreaming (this.isLastHtmlGroup index))}}
              {{wrapLastTextNodeInStreamingTextSpan
                (sanitizedHtml htmlPart.content)
              }}
            {{else}}
              {{sanitizedHtml htmlPart.content}}
            {{/if}}
          {{/if}}
        {{/each}}
      {{/if}}
    </Message>

    <style scoped>
      .ai-bot-message {
        color: var(--ai-assistant-ink, var(--boxel-light));
        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      /* the work under way: one quiet line that moves on with it */
      .reasoning-tail {
        margin: 0;
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        color: transparent;
        background: linear-gradient(
            90deg,
            var(--ink-3, #a8a2ba) 0%,
            var(--ink-3, #a8a2ba) 40%,
            var(--foreground, #f3f1f7) 50%,
            var(--ink-3, #a8a2ba) 60%,
            var(--ink-3, #a8a2ba) 100%
          )
          0 0 / 200% 100%;
        background-clip: text;
        -webkit-background-clip: text;
        animation: reasoning-tail-shimmer 2.4s linear infinite;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @keyframes reasoning-tail-shimmer {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: -100% 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .reasoning-tail {
          animation: none;
          color: var(--ink-3, #a8a2ba);
        }
      }
      /* the turn's thinking, opened from its header: quiet text on a rule,
         where it happened */
      .reasoning-shown {
        padding-inline-start: var(--step-12, 12px);
        box-shadow: inset 2px 0 0 var(--border, #3a3446);
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        color: var(--ink-3, #a8a2ba);
      }
      .reasoning-shown :deep(p) {
        margin: 0 0 var(--step-4, 4px);
      }
      .reasoning-body {
        color: var(--ink-2, var(--boxel-300));
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
      }
      .bfm-reply {
        line-height: inherit;
        min-width: 0;
      }
      /* the reply fits the panel at any width: a card or a table never sets
         the panel's width, and a wide table scrolls inside its own box. Its
         blocks and images only: a card or a Pret UI part inside the reply
         keeps its own widths (an unlayered rule here beats every layered
         Pret UI rule it matches) */
      .bfm-reply :deep(.markdown-content > *) {
        max-width: 100%;
      }
      /* a table in a reply, as the board's Main draws it: full width, one
         rounded box with a hairline ring (the box that scrolls a table too
         wide for it), a quiet mono header and hairline rules between rows.
         Nothing inside the box rounds. The card-aware renderer wraps each
         table in .table-wrapper; the streaming one, Prose, does not, so a
         bare table is its own box. */
      /* answer furniture, as the board's Main draws it. Stat chips and
         source refs speak sans: they are figures and names, not strings to
         paste */
      .ai-bot-message :deep(p[data-chips]) {
        display: flex;
        flex-wrap: wrap;
        gap: var(--step-8, 8px);
        font-size: 0;
      }
      /* the reading measure is in ch, which font-size 0 makes nothing: a
         row of chips takes the column's width (prose sets the measure on
         its paragraphs, hence the weight here) */
      .ai-bot-message :deep(p[data-chips][data-chips]),
      .ai-bot-message :deep(.pretui-prose p[data-chips]) {
        max-width: none;
        max-inline-size: none;
      }
      .ai-bot-message :deep(p[data-chips] > code) {
        /* a figure is one line: the row wraps between chips, never inside
           one, and a chip longer than the column truncates */
        flex: 0 0 auto;
        max-inline-size: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        overflow-wrap: normal;
        word-break: normal;
        padding: var(--step-4, 4px) var(--step-8, 8px);
        border-radius: var(--round-chip, 4px);
        background: var(--inset, #272330);
        box-shadow: none;
        font-family: inherit;
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--foreground, #f7f8fa);
      }
      /* a figure with its words: one chip, the figure in the chip's ink
         and weight, its words quieter beside it */
      .ai-bot-message :deep(p[data-chips] > [data-chip]) {
        display: inline-flex;
        align-items: baseline;
        gap: var(--step-4, 4px);
        flex: 0 1 auto;
        max-inline-size: 100%;
        min-width: 0;
        padding: var(--step-4, 4px) var(--step-8, 8px);
        border-radius: var(--round-chip, 4px);
        background: var(--inset, #272330);
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        white-space: nowrap;
      }
      .ai-bot-message :deep(p[data-chips] > [data-chip] > code) {
        flex: none;
        padding: 0;
        background: none;
        box-shadow: none;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--foreground, #f7f8fa);
      }
      .ai-bot-message :deep([data-chip-label]) {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--ink-2, #c9c4d6);
      }
      .ai-bot-message :deep(a[data-ref]) {
        display: inline-block;
        padding: 0 var(--step-4, 4px);
        border-radius: var(--round-chip, 4px);
        background: var(--inset, #2f2a3a);
        font-family: inherit;
        font-size: var(--type-caption, 11px);
        font-weight: 600;
        line-height: var(--leading-caption, 16px);
        font-variant-numeric: tabular-nums;
        text-decoration: none;
      }
      .ai-bot-message :deep(p[data-sources]) {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--step-8, 8px);
        font-size: var(--type-caption, 11px);
        line-height: var(--leading-caption, 16px);
        color: var(--ink-3, #a8a2ba);
      }
      .ai-bot-message :deep(p[data-sources] a) {
        padding: 2px var(--step-8, 8px);
        border-radius: var(--round-row, 8px);
        box-shadow: inset 0 0 0 1px var(--border, #3a3446);
        text-decoration: none;
        white-space: nowrap;
      }
      .ai-bot-message :deep(p[data-sources] a[data-host]::after) {
        content: attr(data-host);
        margin-inline-start: var(--step-4, 4px);
        font-family: var(--boxel-font-family, inherit);
        color: var(--ink-2, #c9c4d6);
      }
      .ai-bot-message :deep(p[data-sources] span[data-sep]) {
        display: none;
      }
      .ai-bot-message :deep(p[data-method]) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        overflow: hidden;
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        color: var(--ink-2, #c9c4d6);
        cursor: pointer;
      }
      .ai-bot-message :deep(p[data-method][data-open='true']) {
        display: block;
      }
      .ai-bot-message :deep(p[data-method] > strong) {
        font-weight: 600;
        color: var(--ink-3, #a8a2ba);
      }
      /* the disclosure mark leads, as every other fold in the thread does:
         "› Method: …", turning when open */
      .ai-bot-message :deep(p[data-method] > strong::before) {
        content: '›';
        display: inline-block;
        width: 10px;
        margin-inline-end: 4px;
        text-align: center;
        transition: transform 160ms cubic-bezier(0.22, 0.61, 0.25, 1);
      }
      .ai-bot-message :deep(p[data-method][data-open='true'] > strong::before) {
        transform: rotate(90deg);
      }
      .ai-bot-message :deep(p[data-method]:focus-visible) {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .ai-bot-message :deep(.markdown-content) {
        max-width: none;
      }
      /* a finished reply keeps the rhythm it streamed in, so the swap from
         the streaming renderer moves nothing: 12 between blocks, the
         reading line's 22px, and no margin at its edges, so the reply sits
         on the transcript's 12px like every other block */
      .bfm-reply :deep(.markdown-content > *) {
        margin-block: 0 var(--step-12, 12px);
      }
      .bfm-reply :deep(.markdown-content > :last-child) {
        margin-block-end: 0;
      }
      .bfm-reply :deep([data-card-ref]) {
        cursor: pointer;
      }
      .bfm-reply :deep([data-card-ref]:focus-visible) {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }
      /* a card in its own box clips to its rounded corners, which would cut
         a ring drawn outside it: the box itself carries the ring, inside its
         edge, all the way round */
      .bfm-reply
        :deep(
          :is(
              .markdown-bfm-card-slot--block,
              .markdown-bfm-card-slot--inline-embed
            )
            [data-card-ref]:focus-visible
        ) {
        outline: none;
      }
      .bfm-reply
        :deep(
          :is(
            .markdown-bfm-card-slot--block,
            .markdown-bfm-card-slot--inline-embed
          ):has([data-card-ref]:focus-visible)
        ) {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: -2px;
      }
      /* a block card draws its own frame (CardEmbed); a card embedded in a
         line gets the light card surface a final result has, so its own
         colours read as designed */
      .bfm-reply :deep(.markdown-bfm-card-slot--block) {
        display: block;
        margin-block: 0;
      }
      .bfm-reply :deep(.markdown-bfm-card-slot--inline-embed) {
        display: block;
        margin-block: 0;
        border-radius: var(--round-surface, 12px);
        background: var(--boxel-light);
        color: var(--boxel-dark);
        overflow: hidden;
        box-shadow: 0 0 0 1px var(--boxel-600);
      }
      /* a card in a reply is a light card in a dark panel: it gets the
         light theme's inks back, or its text would take the panel's
         foreground and vanish on its own white face */
      .bfm-reply :deep(.markdown-bfm-card-slot) {
        --foreground: var(--boxel-dark);
        --ai-assistant-ink: var(--boxel-dark);
        --muted-foreground: var(--boxel-500);
        --subtle-foreground: var(--boxel-450);
        --pretui-toolrow-settled-ink: var(--boxel-600);
        --background: var(--boxel-light);
        --card: var(--boxel-light);
        --inset: var(--boxel-100);
        --border: var(--boxel-200);
        color: var(--boxel-dark);
      }
      /* a fitted card the reply gives no height is a size container, so
         its content cannot grow it: give it a tile's height rather than the
         40px strip that cuts it to one line */
      .bfm-reply
        :deep(
          .markdown-bfm-card-slot--fitted:not([style*='height'])
            > .field-component-card
        ),
      .bfm-reply
        :deep(
          .markdown-bfm-card-slot--fitted:not([style*='height'])
            .pretui-embed-card
            > .field-component-card
        ) {
        height: 5.5rem;
      }
      /* the slot is the one rounded box; the card inside meets its edge
         square */
      .bfm-reply :deep(.markdown-bfm-card-slot > .field-component-card),
      .bfm-reply
        :deep(
          .markdown-bfm-card-slot .pretui-embed-card > .field-component-card
        ) {
        border-radius: 0;
      }
      /* a card named in a sentence is one pill: UI type, semibold, 18px
         tall inside the reading line's 22, so the leading never jumps; 8px
         each side, the slot the only rounded box. The card inside takes the
         pill's type and no surface of its own */
      .bfm-reply :deep(.markdown-bfm-card-slot--inline),
      .bfm-reply :deep(.markdown-bfm-loading--inline),
      .ai-bot-message :deep(.streamed-card-ref) {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        height: 18px;
        padding: 0 var(--step-8, 8px);
        vertical-align: 1px;
        border-radius: var(--round-row, 8px);
        background: var(--boxel-light);
        color: var(--boxel-dark);
        font-size: var(--type-ui, 12.5px);
        font-weight: 600;
        line-height: 18px;
        overflow: hidden;
        cursor: pointer;
      }
      /* a card still loading is already its pill, named from its URL: the
         shell's shimmer bar is 6em by 1.2em on the middle of the line, and
         the line moved when the card replaced it */
      .bfm-reply :deep(.markdown-content .markdown-bfm-loading--inline) {
        width: auto;
        height: 18px;
        vertical-align: 1px;
        border-radius: var(--round-row, 8px);
        background: var(--boxel-light);
        white-space: nowrap;
      }
      .bfm-reply :deep(.markdown-bfm-card-slot--inline:hover) {
        background: var(--boxel-100);
      }
      .bfm-reply :deep(.markdown-bfm-card-slot--inline *) {
        cursor: pointer;
      }
      .bfm-reply :deep(.markdown-bfm-card-slot--inline > .field-component-card),
      .bfm-reply :deep(.markdown-bfm-card-slot--inline .atom-default-template) {
        min-width: 0;
        background: none;
        box-shadow: none;
        outline: 0;
        font: inherit;
        line-height: inherit;
        color: inherit;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* a stopped reply, as AgentTurn's stopped note: a quiet caption on
         the text edge, in sans: it is status, not a string to paste */
      .generation-cancelled,
      .ai-bot-message :deep(.generation-cancelled) {
        margin: var(--step-12, 12px) 0 0;
        font-size: var(--type-caption, 11px);
        line-height: var(--leading-caption, 16px);
        color: var(--ink-3, var(--boxel-450));
      }
      :deep(span.streaming-text:after) {
        content: '';
        width: 8px;
        height: 8px;
        background: currentColor;
        border-radius: 50%;
        display: inline-block;
        font-family: system-ui, sans-serif;
        line-height: normal;
        vertical-align: baseline;
        margin-left: 5px;
      }
    </style>
  </template>
}

// a path's last segment with an extension: a file, not a card's id
const FILE_EXTENSION = /\/[^/]+\.[a-z0-9]+$/i;

// `:card[…]`, `::card[…]`, `:file[…]`, `::file[…]` anywhere in the reply.
const CARD_REF = /:{1,2}(card|file)\[/;

// a reference at the end of what has streamed so far, its bracket not yet
// closed
const PARTIAL_CARD_REF = /:{1,2}(card|file)\[[^\]\n]*$/;

// the markup a reference renders to while the reply streams: its URL as
// the element's text (runtime-common/bfm-card-references.ts)
const STREAMED_REF =
  /<(span|div) (data-boxel-bfm-(?:inline|block)-ref)="([^"]*)"([^>]*)>[^<]*<\/\1>/g;

const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescapeAttr = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// While a reply streams, a card reference shows as the pill it will become,
// named from its URL, in place of the URL itself: the pill is one line, the
// URL wrapped over three, and the text around it would jump when the card
// loaded.
function namedCardRefs(html: string): string {
  return html.replace(
    STREAMED_REF,
    (_all, tag: string, attr: string, url: string, rest: string) =>
      `<${tag} ${attr}="${url}"${rest}><span class="streamed-card-ref">${escapeText(
        cardRefLabel(unescapeAttr(url)),
      )}</span></${tag}>`,
  );
}

function isHtmlPreTagGroup(
  htmlPart: HtmlTagGroup,
): htmlPart is HtmlPreTagGroup {
  return htmlPart.type === 'pre_tag';
}

interface HtmlGroupCodeBlockSignature {
  Element: HTMLDivElement;
  Args: {
    codeData: CodeData;
    monacoSDK: MonacoSDK;
    index: number;
  };
}

const HtmlGroupCodeBlock: TemplateOnlyComponent<HtmlGroupCodeBlockSignature> =
  <template>
    <CodeBlock
      @monacoSDK={{@monacoSDK}}
      @codeData={{@codeData}}
      data-test-code-block-index={{@index}}
      as |codeBlock|
    >
      <codeBlock.editor @code={{@codeData.code}} />
      <codeBlock.actions as |actions|>
        <actions.copyCode @textToCopy={{@codeData.code}} />
      </codeBlock.actions>
    </CodeBlock>
  </template>;
