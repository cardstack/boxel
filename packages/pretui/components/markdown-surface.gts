// Pretui — MarkdownSurface: an answer's typography, for markdown however it
// was rendered.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Prose } from './prose';

export interface MarkdownSurfaceSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// The reading voice an assistant's answer takes on top of Prose: reading
// type at full ink, the heading ladder, code at the data size, tables at the
// reading size with caption headers, and the reading measure per text block
// rather than on the whole answer. MarkdownStream renders inside it while an
// answer streams; a host that renders a finished answer another way (say, to
// mount the cards it names) wraps that markup in it, so the swap moves no
// pixel. The markup is not this component's, so every rule reaches it
// through :deep().
export const MarkdownSurface: TemplateOnlyComponent<MarkdownSurfaceSignature> =
  <template>
    <div
      class='pretui-md-surface'
      data-test-pretui-markdown-surface
      ...attributes
    >
      <Prose class='pretui-md-surface-prose'>{{yield}}</Prose>
    </div>
    <style scoped>
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* Prose reads its leading from the body tokens, so they are pointed
           at the reading role here. Its own measure is lifted so code and
           tables can take a wider panel; the line length is capped per text
           block below instead. */
        .pretui-md-surface {
          --text-body: var(--boxel-body-font-size);
          --leading-body: var(--boxel-body-line-height);
          --pretui-prose-measure: none;
          min-width: 0;
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
          color: var(--foreground);
        }
        /* wider panels widen tables, diffs and cards, never line length */
        .pretui-md-surface
          :deep(:is(p, ul, ol, dl, blockquote, h1, h2, h3, h4, h5, h6)) {
          max-inline-size: var(--measure-read, 68ch);
        }
        /* the heading ladder: the first heading at heading size, h2 at
           reading size, h3 at UI size in tracked caps; all 600 */
        .pretui-md-surface :deep(:is(h1, h2, h3, h4, h5, h6)) {
          margin: var(--boxel-sp-lg) 0 var(--boxel-sp-xs);
          font-weight: 600;
          letter-spacing: normal;
          text-transform: none;
        }
        .pretui-md-surface :deep(h1) {
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
        }
        .pretui-md-surface :deep(h2) {
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
        }
        .pretui-md-surface :deep(h3) {
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .pretui-md-surface :deep(:is(h4, h5, h6)) {
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-md-surface :deep(:is(h1, h2, h3, h4, h5, h6):first-child) {
          margin-block-start: 0;
        }
        /* code is a pasteable string: mono at the data size */
        .pretui-md-surface :deep(code) {
          font-size: var(--boxel-font-size-xs);
          border-radius: var(--boxel-border-radius-xs);
        }
        .pretui-md-surface :deep(pre) {
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          border-radius: var(--boxel-border-radius-sm);
        }
        .pretui-md-surface :deep(pre code) {
          font-size: inherit;
          border-radius: 0;
        }
        /* answer table cells read at reading size; headers are caption in
           tracked caps, the only other tracked caps an answer has */
        .pretui-md-surface :deep(table) {
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
        }
        .pretui-md-surface :deep(th) {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          vertical-align: bottom;
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>;
