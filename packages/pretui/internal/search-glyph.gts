// Pretui — the magnifier at the start of SearchInput and Input @type='search'.
// It sits in the field's positioned box, centered on the field's height, and
// starts where the text starts in the other fields: the 1px border plus the
// 9px inset. The field's inline padding-inline-start clears it. @dimmed
// matches BoxelInput's 0.5 opacity on a disabled or read-only field.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import SearchIcon from '@cardstack/boxel-icons/search';

export const SEARCH_START_PADDING = 'padding-inline-start: 1.875rem;';

interface SearchGlyphSignature {
  Args: { dimmed?: boolean };
  Element: HTMLSpanElement;
}

export const SearchGlyph: TemplateOnlyComponent<SearchGlyphSignature> =
  <template>
    <span
      class='pretui-searchglyph'
      data-dimmed={{if @dimmed 'true'}}
      aria-hidden='true'
    >
      <SearchIcon width='14' height='14' />
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-searchglyph {
          position: absolute;
          top: calc((var(--boxel-input-height) - 0.875rem) / 2);
          inset-inline-start: 0.625rem;
          display: flex;
          color: var(--muted-foreground);
          pointer-events: none;
        }
        .pretui-searchglyph[data-dimmed] {
          opacity: 0.5;
        }
      }
    </style>
  </template>;
