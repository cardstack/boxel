// One choice of a list drawn as tiles to click: a bordered tile wrapping a
// radio button that is hidden but stays in the tab order and the
// accessibility tree, so the arrow keys and screen readers work as for any
// radio group. The chosen tile is filled with the theme's selected color and
// ringed in its primary ink, which holds WCAG's 3:1 for a non-text indicator
// against the panel where the primary color itself is too faint. A hovered
// tile takes a thinner ring of the same ink and no fill, so it never reads as
// more chosen than the chosen one. Keyboard focus rings the tile. The block
// is the tile's content: it sets its own padding, leaves its background
// clear so the fill shows, and its text is the radio's accessible name.
// Attributes go on the tile's label.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Args: {
    // The radio group's name, shared by every tile of one list.
    name: string;
    checked: boolean;
    onChange: (event: Event) => void;
    value?: string | number;
  };
  Blocks: { default: [] };
  Element: HTMLLabelElement;
}

const RadioTile: TemplateOnlyComponent<Signature> = <template>
  <label class='radio-tile' ...attributes>
    <input
      type='radio'
      name={{@name}}
      value={{@value}}
      checked={{@checked}}
      {{on 'change' @onChange}}
    />
    {{yield}}
  </label>

  <style scoped>
    .radio-tile {
      position: relative;
      display: block;
      background-color: var(--card, var(--background));
      color: var(--card-foreground, var(--foreground));
      border-radius: var(--boxel-border-radius);
      box-shadow: 0 0 0 1px var(--border);
      cursor: pointer;
    }
    .radio-tile input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
    }
    .radio-tile:hover {
      box-shadow: 0 0 0 1px var(--primary-ink);
    }
    .radio-tile:has(input:checked) {
      background-color: var(--selected);
      box-shadow: 0 0 0 2px var(--primary-ink);
      /* Forced colors drop the box shadow and the fill; this outline, unseen
         otherwise, is repainted there so the chosen tile still stands out. */
      outline: 2px solid transparent;
      outline-offset: -2px;
    }
    /* Clear of the chosen ring, with a gap, so a focused chosen tile shows
       both rings rather than one thick one. */
    .radio-tile:has(input:focus-visible) {
      outline: 2px solid var(--ring, var(--boxel-highlight));
      outline-offset: 4px;
    }
  </style>
</template>;

export default RadioTile;
