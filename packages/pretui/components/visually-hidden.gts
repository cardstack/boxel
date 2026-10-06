// Pretui — VisuallyHidden: text for assistive technology that takes no space on screen.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface VisuallyHiddenSignature {
  Args: {
    /** Show the content while it, or anything in it, has focus — the skip-link case. */
    focusable?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

// The clip pattern, not `display: none`, `visibility: hidden` or
// `aria-hidden`: all three take the text out of the accessibility tree, which
// is the opposite of the point. One pixel, clipped to nothing, never wrapped
// so a screen reader reads it as one run.
export const VisuallyHidden: TemplateOnlyComponent<VisuallyHiddenSignature> = <template>
  <span
    class='pretui-visually-hidden'
    data-focusable={{if @focusable 'true' 'false'}}
    data-test-pretui-visually-hidden
    ...attributes
  >{{yield}}</span>
  <style scoped>
    @layer PretComponent {
      .pretui-visually-hidden {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .pretui-visually-hidden[data-focusable='true']:focus-within,
      .pretui-visually-hidden[data-focusable='true']:focus {
        position: static;
        inline-size: auto;
        block-size: auto;
        margin: 0;
        overflow: visible;
        clip-path: none;
        white-space: normal;
      }
    }
  </style>
</template>;
