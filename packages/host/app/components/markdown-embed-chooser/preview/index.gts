import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  bfmBlockFormatAndSize,
  type BfmSizeSpec,
} from '@cardstack/runtime-common/bfm-card-references';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type {
  CardDef,
  FileDef,
  Format,
} from 'https://cardstack.com/base/card-api';

type EmbedFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';

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
  };
}

// Renders a resolved card/file in the requested format + size, matching how
// `rendered-markdown.gts` paints the eventual document slot. The chooser's
// preview pane wraps this with format/size controls; later tickets reuse it in
// the Edit modal and inline overlay.
export default class MarkdownEmbedPreview extends Component<Signature> {
  private get kind(): 'inline' | 'block' {
    return this.args.kind ?? 'block';
  }

  private get renderFormat(): Format {
    return this.args.format;
  }

  // Fitted slots carry an inline width/height plus `overflow: hidden` so the
  // instance occupies the requested footprint — derived through the same helper
  // the live markdown renderer uses (`rendered-markdown.gts`).
  private get sizeStyle(): ReturnType<typeof htmlSafe> | undefined {
    if (this.args.format !== 'fitted') {
      return undefined;
    }
    let { width, height } = this.args.sizeSpec ?? { format: 'fitted' };
    let { sizeStyle } = bfmBlockFormatAndSize(
      'fitted',
      width === undefined ? undefined : String(width),
      height === undefined ? undefined : String(height),
    );
    return htmlSafe(
      sizeStyle ? `${sizeStyle}; overflow: hidden` : 'overflow: hidden',
    );
  }

  <template>
    {{#if (eq this.kind 'inline')}}
      <span
        class='markdown-embed-preview markdown-embed-preview--inline
          {{if this.sizeStyle "markdown-embed-preview--fitted"}}'
        style={{this.sizeStyle}}
        data-test-markdown-embed-preview
        data-test-markdown-embed-preview-format={{this.renderFormat}}
        ...attributes
      >
        <CardRenderer
          @card={{@target}}
          @format={{this.renderFormat}}
          @displayContainer={{false}}
        />
      </span>
    {{else}}
      <div
        class='markdown-embed-preview markdown-embed-preview--block
          {{if this.sizeStyle "markdown-embed-preview--fitted"}}'
        style={{this.sizeStyle}}
        data-test-markdown-embed-preview
        data-test-markdown-embed-preview-format={{this.renderFormat}}
        ...attributes
      >
        <CardRenderer
          @card={{@target}}
          @format={{this.renderFormat}}
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
      .markdown-embed-preview--block {
        display: block;
      }
      .markdown-embed-preview--fitted {
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
    </style>
  </template>
}
