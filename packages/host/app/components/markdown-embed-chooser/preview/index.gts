import type { TOC } from '@ember/component/template-only';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  bfmRefFormatAndSize,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type {
  CardDef,
  FileDef,
  Format,
} from 'https://cardstack.com/base/card-api';

type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';

interface EmbedSignature {
  Element: HTMLElement;
  Args: {
    target: CardDef | FileDef;
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
        {{if @sizeStyle "markdown-embed-preview--fitted"}}'
      style={{@sizeStyle}}
      data-test-markdown-embed-preview
      data-test-markdown-embed-preview-format={{@format}}
      ...attributes
    >
      <CardRenderer
        @card={{@target}}
        @format={{@format}}
        @displayContainer={{false}}
      />
    </span>
  {{else}}
    <div
      class='markdown-embed-preview markdown-embed-preview--block
        {{if @sizeStyle "markdown-embed-preview--fitted"}}'
      style={{@sizeStyle}}
      data-test-markdown-embed-preview
      data-test-markdown-embed-preview-format={{@format}}
      ...attributes
    >
      <CardRenderer
        @card={{@target}}
        @format={{@format}}
        @displayContainer={{false}}
      />
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
  </style>
</template>;

interface Signature {
  Element: HTMLElement;
  Args: {
    // Already-resolved instance to preview. Both card refs (`:card[...]`) and
    // file refs (`:file[...]`) render through the same CardRenderer, so the
    // caller resolves the URL and hands us the instance — this component loads
    // nothing.
    target: CardDef | FileDef;
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
          <Embed
            @target={{@target}}
            @format={{this.renderFormat}}
            @kind={{this.kind}}
            @sizeStyle={{this.sizeStyle}}
          />
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
    {{else}}
      <Embed
        @target={{@target}}
        @format={{this.renderFormat}}
        @kind={{this.kind}}
        @sizeStyle={{this.sizeStyle}}
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
