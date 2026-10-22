import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';

interface Signature {
  Args: {
    onToggle: () => void;
    open: boolean;
  };
  Element: HTMLButtonElement;
}

/** Opens and closes a demo's DialKit lab, wherever the demo shows one. */
export const LabToggle: TOC<Signature> = <template>
  <button
    type='button'
    class='lab-toggle'
    aria-expanded={{if @open 'true' 'false'}}
    {{on 'click' @onToggle}}
    ...attributes
  >{{if @open 'Close the DialKit lab' 'Tune this demo with DialKit'}}</button>
  <style scoped>
    .lab-toggle {
      padding: 0;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--ink-dim);
      background: none;
      border: 0;
      cursor: pointer;
    }

    @media (hover: hover) {
      .lab-toggle:hover {
        color: var(--ink);
      }
    }

    .lab-toggle[aria-expanded='true'] {
      color: var(--copper-ink);
    }
  </style>
</template>;
