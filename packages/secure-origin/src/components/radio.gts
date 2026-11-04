// A radio button drawn by the page rather than the browser: an empty circle
// unchosen, and a ring with a dot inside it chosen. The shell declares a dark
// color scheme, under which the browser's own radio paints an unchosen button
// as a dark disc even on a light panel, so this draws every state itself, as
// the package's Checkbox does. It stays a native radio input, so a group
// sharing a name is one tab stop, the arrow keys move the choice within it,
// and screen readers announce it as any radio. Attributes go on the input, so
// a label wrapping it names it.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Args: {
    // The radio group's name, shared by every button of one choice.
    name: string;
    value: string;
    checked: boolean;
    onChange: (event: Event) => void;
    disabled?: boolean;
  };
  Element: HTMLInputElement;
}

const Radio: TemplateOnlyComponent<Signature> = <template>
  <input
    class='radio'
    type='radio'
    name={{@name}}
    value={{@value}}
    checked={{@checked}}
    disabled={{@disabled}}
    {{on 'change' @onChange}}
    ...attributes
  />

  <style scoped>
    .radio {
      --radio-size: var(--boxel-radio-size, var(--boxel-body-font-size));
      --radio-border-color: var(--boxel-radio-border-color, var(--border));
      --radio-background: var(
        --boxel-radio-background-color,
        var(--background)
      );
      --radio-checked-color: var(
        --boxel-radio-checked-color,
        var(--primary-ink, var(--primary))
      );

      appearance: none;
      /* stylelint-disable-next-line property-no-vendor-prefix */
      -webkit-appearance: none;
      box-sizing: border-box;
      flex-shrink: 0;
      width: var(--radio-size);
      height: var(--radio-size);
      margin: 0;
      padding: 0;
      border: 1px solid var(--radio-border-color);
      border-radius: 50%;
      background-color: var(--radio-background);
      cursor: pointer;
      transition:
        background-color var(--boxel-transition),
        border-color var(--boxel-transition),
        box-shadow var(--boxel-transition);
    }
    /* The dot is the checked color showing through a ring of the background
       inset from the edge. */
    .radio:checked {
      border-color: var(--radio-checked-color);
      background-color: var(--radio-checked-color);
      box-shadow: inset 0 0 0 calc(var(--radio-size) * 0.22)
        var(--radio-background);
    }
    .radio:hover:not(:disabled):not(:checked) {
      border-color: currentColor;
    }
    .radio:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }
    .radio:disabled {
      opacity: 0.5;
      cursor: default;
    }
    /* Forced colors drop the inset ring that draws the dot, so the browser's
       own radio, drawn in the system colors, stands in there. */
    @media (forced-colors: active) {
      .radio {
        appearance: auto;
        /* stylelint-disable-next-line property-no-vendor-prefix */
        -webkit-appearance: auto;
      }
    }
  </style>
</template>;

export default Radio;
