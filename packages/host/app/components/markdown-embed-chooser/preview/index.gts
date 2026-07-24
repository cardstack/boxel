import type { TOC } from '@ember/component/template-only';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';

import {
  BrokenLinkTemplate,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import type {
  BrokenLinkErrorDoc,
  BrokenLinkItemType,
  BrokenLinkState,
} from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';

import {
  bfmRefFormatAndSize,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type { CardDef, FileDef, Format } from '@cardstack/base/card-api';

type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';

// Stable identity for the "no error doc" fallback so the getter below doesn't
// hand the broken template a fresh object every render (which would churn
// downstream renders). The broken template only reads fields, never mutates.
const EMPTY_ERROR_DOC: BrokenLinkErrorDoc = Object.freeze({});

interface EmbedSignature {
  Element: HTMLElement;
  Args: {
    // The resolved instance to render. Absent while `loading` — the box then
    // holds a spinner in place of the card body, keeping the same footprint.
    target?: CardDef | FileDef;
    loading?: boolean;
    format: Format;
    kind: 'inline' | 'block';
    sizeStyle?: ReturnType<typeof htmlSafe>;
  };
}

// The embed itself: inline placement flows within text (`<span>`), block gives
// it its own line (`<div>`). Both render through the same CardRenderer. Inline
// atom uses `inline-flex` to align with text baseline; every other inline
// format uses `inline-block` so the card occupies its intrinsic (or fitted)
// width — mirrors the live markdown renderer's `--inline-embed` slot.
const Embed: TOC<EmbedSignature> = <template>
  {{#if (eq @kind 'inline')}}
    <span
      class='markdown-embed-preview
        {{if
          (eq @format "atom")
          "markdown-embed-preview--inline"
          "markdown-embed-preview--inline-embed"
        }}
        {{if @sizeStyle "markdown-embed-preview--fitted"}}
        {{if (not (eq @format "atom")) "markdown-embed-preview--card-frame"}}
        {{if @loading "is-loading"}}'
      style={{@sizeStyle}}
      data-test-markdown-embed-preview={{if (not @loading) 'true'}}
      data-test-markdown-embed-preview-format={{if (not @loading) @format}}
      data-test-markdown-embed-preview-loading={{if @loading 'true'}}
      ...attributes
    >
      {{#if @target}}
        <CardRenderer
          @card={{@target}}
          @format={{@format}}
          @displayContainer={{false}}
        />
      {{else if @loading}}
        <LoadingIndicator class='markdown-embed-preview__spinner' />
      {{/if}}
    </span>
  {{else}}
    <div
      class='markdown-embed-preview markdown-embed-preview--block
        {{if @sizeStyle "markdown-embed-preview--fitted"}}
        {{if (not (eq @format "atom")) "markdown-embed-preview--card-frame"}}
        {{if @loading "is-loading"}}'
      style={{@sizeStyle}}
      data-test-markdown-embed-preview={{if (not @loading) 'true'}}
      data-test-markdown-embed-preview-format={{if (not @loading) @format}}
      data-test-markdown-embed-preview-loading={{if @loading 'true'}}
      ...attributes
    >
      {{#if @target}}
        <CardRenderer
          @card={{@target}}
          @format={{@format}}
          @displayContainer={{false}}
        />
      {{else if @loading}}
        <LoadingIndicator class='markdown-embed-preview__spinner' />
      {{/if}}
    </div>
  {{/if}}
  <style scoped>
    .markdown-embed-preview {
      max-width: 100%;
    }
    .markdown-embed-preview--inline {
      display: inline-flex;
      vertical-align: middle;
    }
    .markdown-embed-preview--inline-embed {
      display: inline-block;
      vertical-align: middle;
    }
    .markdown-embed-preview--block {
      display: block;
    }
    .markdown-embed-preview--fitted {
      border-radius: var(--boxel-border-radius);
      overflow: hidden;
    }
    /* Frame the embed so reviewers can see where the card body sits against
       the pane background — applied for embedded/isolated/fitted, never atom
       (which is its own pill shape). */
    .markdown-embed-preview--card-frame {
      border: 1px solid var(--boxel-300);
      border-radius: var(--boxel-border-radius);
      background-color: var(--boxel-light);
      overflow: hidden;
    }
    /* Loading placeholder: keep the resolved embed's footprint (size + frame)
       but center a small spinner where the card body will land. Force a flex
       box so the spinner centers in the block / inline-embed variants (the atom
       variant is already inline-flex). */
    .markdown-embed-preview.is-loading {
      align-items: center;
      justify-content: center;
    }
    .markdown-embed-preview--block.is-loading {
      display: flex;
    }
    .markdown-embed-preview--inline-embed.is-loading {
      display: inline-flex;
    }
    /* Small enough to sit inside an atom pill, unobtrusive in larger frames. */
    .markdown-embed-preview__spinner {
      --boxel-loading-indicator-size: 1.25rem;
    }
  </style>
</template>;

interface BrokenEmbedSignature {
  Element: HTMLElement;
  Args: {
    brokenUrl: string;
    errorDoc: BrokenLinkErrorDoc;
    state: BrokenLinkState;
    displayName?: string;
    itemType?: BrokenLinkItemType;
    format: EmbedFormat;
    kind: 'inline' | 'block';
    sizeStyle?: ReturnType<typeof htmlSafe>;
  };
}

// Placement wrapper for a broken ref, mirroring Embed's inline/block behavior so
// a broken inline ref (`:card[url | embedded]`) previews inline — the same
// placement it will serialize to — rather than collapsing to a block. Unlike
// Embed it adds no card-frame and never sets `overflow: hidden`: the broken
// template draws its own box, and its reveal overlay must stay free to extend
// beyond the placeholder footprint. It carries no `data-test-markdown-embed-preview`
// so the broken state stays distinguishable from a resolved embed.
const BrokenEmbed: TOC<BrokenEmbedSignature> = <template>
  {{#if (eq @kind 'inline')}}
    <span
      class='broken-embed
        {{if
          (eq @format "atom")
          "broken-embed--inline"
          "broken-embed--inline-embed"
        }}'
      ...attributes
    >
      <BrokenLinkTemplate
        @brokenUrl={{@brokenUrl}}
        @displayName={{@displayName}}
        @itemType={{@itemType}}
        @errorDoc={{@errorDoc}}
        @state={{@state}}
        @format={{@format}}
        style={{@sizeStyle}}
      />
    </span>
  {{else}}
    <div class='broken-embed broken-embed--block' ...attributes>
      <BrokenLinkTemplate
        @brokenUrl={{@brokenUrl}}
        @displayName={{@displayName}}
        @itemType={{@itemType}}
        @errorDoc={{@errorDoc}}
        @state={{@state}}
        @format={{@format}}
        style={{@sizeStyle}}
      />
    </div>
  {{/if}}
  <style scoped>
    .broken-embed {
      max-width: 100%;
    }
    .broken-embed--inline {
      display: inline-flex;
      vertical-align: middle;
    }
    .broken-embed--inline-embed {
      display: inline-block;
      vertical-align: middle;
    }
    .broken-embed--block {
      display: block;
    }
  </style>
</template>;

interface Signature {
  Element: HTMLElement;
  Args: {
    // Already-resolved instance to preview. Both card refs (`:card[...]`) and
    // file refs (`:file[...]`) render through the same CardRenderer, so the
    // caller resolves the URL and hands us the instance — this component loads
    // nothing. Absent when the ref failed to resolve; the broken-ref args
    // below then drive the render.
    target?: CardDef | FileDef;
    // True while the caller is still resolving the target. Renders a
    // size-matched loading placeholder (the card's footprint with a spinner)
    // in the embed's slot until `target` or a broken-ref state arrives.
    loading?: boolean;
    // Broken-ref render: when `brokenUrl` is present (and `target` is not),
    // render `BrokenLinkTemplate` instead of the embed. The same warning box +
    // reveal overlay the base `linksTo` broken UI shows, format-aware so the
    // format dropdown still drives its footprint. No `@viewCard` — the chooser
    // offers no "Open anyway".
    brokenUrl?: string;
    errorDoc?: BrokenLinkErrorDoc;
    brokenState?: BrokenLinkState;
    brokenDisplayName?: string;
    brokenItemType?: BrokenLinkItemType;
    // Render format. `fitted` consults `@sizeSpec` for its width/height;
    // atom/embedded/isolated ignore it.
    format: EmbedFormat;
    // Width/height for fitted renders. Width may be a px number or a `%`
    // string; height is a px number. Ignored unless `@format` is 'fitted'.
    sizeSpec?: BfmSizeSpec;
    // Placement only: inline flows the preview within text (`<span>`); block
    // gives it its own line (`<div>`). Does NOT change the render format.
    // Default: 'block'.
    kind?: 'inline' | 'block';
    // When true, the embed is shown inside placeholder document text so the
    // viewer sees how it sits in a real markdown doc: an inline embed flows
    // within the paragraph, a block embed breaks onto its own line. Off by
    // default so format galleries / overlays can render the bare embed.
    showSurroundingText?: boolean;
  };
}

// Renders a resolved card/file in the requested format + size, matching how
// `rendered-markdown.gts` paints the eventual document slot. With
// `@showSurroundingText` it wraps the embed in skeleton document text to
// preview placement in context; the chooser's preview pane turns this on.
export default class MarkdownEmbedPreview extends Component<Signature> {
  private get kind(): 'inline' | 'block' {
    return this.args.kind ?? 'block';
  }

  private get renderFormat(): Format {
    return this.args.format;
  }

  // The broken template requires a state + error doc; default them so the arg
  // types stay optional at this boundary (the parent only sets them alongside
  // `brokenUrl`, but the correlation isn't expressible in the type).
  private get brokenState(): BrokenLinkState {
    return this.args.brokenState ?? 'error';
  }

  private get brokenErrorDoc(): BrokenLinkErrorDoc {
    return this.args.errorDoc ?? EMPTY_ERROR_DOC;
  }

  // A fitted broken placeholder takes the same picked footprint as a real
  // fitted embed, so the chooser previews the actual tile size rather than
  // collapsing to the template's min-height. Unlike the embed's `sizeStyle`
  // this omits `overflow: hidden`: the broken template's root must not clip, or
  // the reveal overlay (which extends beyond the placeholder) would be cut off
  // — the inner `.box` handles its own clipping. Non-fitted formats keep their
  // intrinsic footprint.
  private get brokenSizeStyle(): ReturnType<typeof htmlSafe> | undefined {
    if (this.args.format !== 'fitted') {
      return undefined;
    }
    let { width, height } = this.args.sizeSpec ?? { format: 'fitted' };
    let { sizeStyle } = bfmRefFormatAndSize(
      'fitted',
      width === undefined ? undefined : String(width),
      height === undefined ? undefined : String(height),
    );
    return sizeStyle ? htmlSafe(sizeStyle) : undefined;
  }

  // Fitted slots carry an inline width/height plus `overflow: hidden` so the
  // instance occupies the requested footprint — derived through the same helper
  // the live markdown renderer uses (`rendered-markdown.gts`). Inline embedded
  // and isolated have no intrinsic inline width: the default template's
  // `width/height: 100%` resolves against the inline-block wrapper, which is
  // itself shrink-wrapping, and the box collapses. Give the wrapper a definite
  // footprint that matches the live renderer's loading placeholders so the
  // preview shows a real card body.
  private get sizeStyle(): ReturnType<typeof htmlSafe> | undefined {
    let { format } = this.args;
    if (format === 'fitted') {
      let { width, height } = this.args.sizeSpec ?? { format: 'fitted' };
      let { sizeStyle } = bfmRefFormatAndSize(
        'fitted',
        width === undefined ? undefined : String(width),
        height === undefined ? undefined : String(height),
      );
      return htmlSafe(
        sizeStyle ? `${sizeStyle}; overflow: hidden` : 'overflow: hidden',
      );
    }
    if (
      this.kind === 'inline' &&
      (format === 'embedded' || format === 'isolated')
    ) {
      let footprint =
        format === 'isolated'
          ? 'width: 24rem; height: 18.75rem'
          : 'width: 16rem; height: 9.375rem';
      return htmlSafe(`${footprint}; overflow: hidden`);
    }
    return undefined;
  }

  <template>
    {{#if @showSurroundingText}}
      <div class='markdown-embed-preview-doc' ...attributes>
        <span
          class='markdown-embed-preview-doc__line'
          aria-hidden='true'
        ></span>
        <span
          class='markdown-embed-preview-doc__line'
          aria-hidden='true'
        ></span>
        <p class='markdown-embed-preview-doc__para'>
          <span
            class='markdown-embed-preview-doc__word'
            aria-hidden='true'
          ></span>
          <span
            class='markdown-embed-preview-doc__word is-sm'
            aria-hidden='true'
          ></span>
          {{#if @target}}
            <Embed
              @target={{@target}}
              @format={{this.renderFormat}}
              @kind={{this.kind}}
              @sizeStyle={{this.sizeStyle}}
            />
          {{else if @loading}}
            <Embed
              @loading={{true}}
              @format={{this.renderFormat}}
              @kind={{this.kind}}
              @sizeStyle={{this.sizeStyle}}
            />
          {{else if @brokenUrl}}
            <BrokenEmbed
              @brokenUrl={{@brokenUrl}}
              @displayName={{@brokenDisplayName}}
              @itemType={{@brokenItemType}}
              @errorDoc={{this.brokenErrorDoc}}
              @state={{this.brokenState}}
              @format={{@format}}
              @kind={{this.kind}}
              @sizeStyle={{this.brokenSizeStyle}}
            />
          {{/if}}
          <span
            class='markdown-embed-preview-doc__word is-lg'
            aria-hidden='true'
          ></span>
          <span
            class='markdown-embed-preview-doc__word'
            aria-hidden='true'
          ></span>
        </p>
        <span
          class='markdown-embed-preview-doc__line'
          aria-hidden='true'
        ></span>
        <span
          class='markdown-embed-preview-doc__line is-short'
          aria-hidden='true'
        ></span>
      </div>
    {{else if @target}}
      <Embed
        @target={{@target}}
        @format={{this.renderFormat}}
        @kind={{this.kind}}
        @sizeStyle={{this.sizeStyle}}
        ...attributes
      />
    {{else if @loading}}
      <Embed
        @loading={{true}}
        @format={{this.renderFormat}}
        @kind={{this.kind}}
        @sizeStyle={{this.sizeStyle}}
        ...attributes
      />
    {{else if @brokenUrl}}
      <BrokenEmbed
        @brokenUrl={{@brokenUrl}}
        @displayName={{@brokenDisplayName}}
        @itemType={{@brokenItemType}}
        @errorDoc={{this.brokenErrorDoc}}
        @state={{this.brokenState}}
        @format={{@format}}
        @kind={{this.kind}}
        @sizeStyle={{this.brokenSizeStyle}}
        ...attributes
      />
    {{/if}}
    <style scoped>
      .markdown-embed-preview-doc {
        width: 100%;
        max-width: 32rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .markdown-embed-preview-doc__line {
        display: block;
        height: 0.75rem;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--boxel-200);
      }
      .markdown-embed-preview-doc__line.is-short {
        width: 60%;
      }
      .markdown-embed-preview-doc__para {
        margin: 0;
        line-height: 2.2;
      }
      .markdown-embed-preview-doc__word {
        display: inline-block;
        width: 5rem;
        height: 0.75rem;
        margin: 0 var(--boxel-sp-5xs);
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--boxel-200);
        vertical-align: middle;
      }
      .markdown-embed-preview-doc__word.is-sm {
        width: 3rem;
      }
      .markdown-embed-preview-doc__word.is-lg {
        width: 7rem;
      }
    </style>
  </template>
}
