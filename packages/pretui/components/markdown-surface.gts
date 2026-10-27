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
// pixel. Prose owns every rule on the markup; this surface only sets Prose's
// `--pretui-prose-*` knobs, so the two cannot disagree.
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
        .pretui-md-surface {
          /* the whole answer is as wide as the panel, so code and tables
             can use it; the line length is capped per text block instead */
          --pretui-prose-measure: none;
          --pretui-prose-block-measure: 68ch;
          --pretui-prose-leading: var(--boxel-body-line-height);
          /* the heading ladder: h1 at the small heading size, h2 at reading
             size, h3 at UI size in tracked caps; all 600 */
          --pretui-prose-heading-gap: var(--boxel-sp-xs);
          --pretui-prose-h1-size: var(--boxel-font-size-sm);
          --pretui-prose-h1-leading: var(--boxel-line-height-sm);
          --pretui-prose-h2-size: var(--boxel-body-font-size);
          --pretui-prose-h2-leading: var(--boxel-body-line-height);
          --pretui-prose-h3-size: var(--boxel-ui-label-font-size);
          --pretui-prose-h3-leading: var(--boxel-ui-label-line-height);
          --pretui-prose-h3-tracking: 0.04em;
          --pretui-prose-h3-case: uppercase;
          --pretui-prose-h4-size: var(--boxel-ui-label-font-size);
          --pretui-prose-h4-leading: var(--boxel-ui-label-line-height);
          /* code is a pasteable string: mono at the data size */
          --pretui-prose-code-size: var(--boxel-font-size-xs);
          --pretui-prose-pre-size: var(--boxel-font-size-xs);
          --pretui-prose-pre-leading: var(--boxel-line-height-xs);
          /* table cells read at reading size; headers are caption in
             tracked caps, the only other tracked caps an answer has */
          --pretui-prose-table-size: var(--boxel-body-font-size);
          --pretui-prose-table-leading: var(--boxel-body-line-height);
          --pretui-prose-th-size: var(--boxel-caption-font-size);
          --pretui-prose-th-leading: var(--boxel-caption-line-height);
          --pretui-prose-th-tracking: 0.04em;
          --pretui-prose-th-case: uppercase;
          --pretui-prose-th-align: bottom;
          --pretui-prose-th-ink: var(--muted-foreground);
          min-width: 0;
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
          color: var(--foreground);
        }
      }
    </style>
  </template>;
