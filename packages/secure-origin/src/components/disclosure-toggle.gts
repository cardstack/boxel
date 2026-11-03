// A button that opens and closes a section below it, marked with a triangle
// that turns as the section opens. It carries `aria-expanded` from
// `@expanded`; the caller gives it `aria-controls`, its click handler, and
// the label's size, weight and colour, so one marker serves every disclosure
// in the window.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Args: { expanded: boolean; disabled?: boolean };
  Blocks: { default: [] };
  Element: HTMLButtonElement;
}

const DisclosureToggle: TemplateOnlyComponent<Signature> = <template>
  <button
    type='button'
    class='disclosure-toggle'
    aria-expanded={{if @expanded 'true' 'false'}}
    disabled={{@disabled}}
    ...attributes
  >{{yield}}</button>

  <style scoped>
    .disclosure-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--boxel-sp-4xs);
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      cursor: pointer;
    }
    .disclosure-toggle::before {
      content: '';
      width: 0;
      height: 0;
      border-top: 0.3em solid transparent;
      border-bottom: 0.3em solid transparent;
      border-left: 0.45em solid currentColor;
      transition: transform 0.15s ease;
    }
    .disclosure-toggle[aria-expanded='true']::before {
      transform: rotate(90deg);
    }
    .disclosure-toggle:disabled {
      cursor: default;
    }
    .disclosure-toggle:focus-visible {
      outline: 2px solid var(--ring, var(--boxel-highlight));
      outline-offset: 2px;
      border-radius: var(--boxel-border-radius-xs, 2px);
    }
    @media (prefers-reduced-motion: reduce) {
      .disclosure-toggle::before {
        transition: none;
      }
    }
  </style>
</template>;

export default DisclosureToggle;
