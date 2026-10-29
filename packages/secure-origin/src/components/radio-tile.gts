// One choice of a list drawn as tiles to click: a bordered tile wrapping a
// radio button that is hidden but stays in the tab order and the
// accessibility tree, so the arrow keys and screen readers work as for any
// radio group. The chosen tile is outlined in the theme's primary color, a
// hovered one in its foreground, and keyboard focus rings the tile. The
// block is the tile's content and sets its own padding, and the tile's text
// is the radio's accessible name. Attributes go on the tile's label.
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
      box-shadow: 0 0 0 1px var(--foreground, var(--boxel-dark));
    }
    .radio-tile:has(input:checked) {
      box-shadow: 0 0 0 2px var(--primary, var(--boxel-highlight));
    }
    .radio-tile:has(input:focus-visible) {
      outline: 2px solid var(--ring, var(--boxel-highlight));
      outline-offset: 2px;
    }
  </style>
</template>;

export default RadioTile;
