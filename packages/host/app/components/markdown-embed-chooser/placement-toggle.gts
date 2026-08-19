import type { TOC } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { eq } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    selected: 'inline' | 'block';
    onChange: (kind: 'inline' | 'block') => void;
    disabled?: boolean;
  };
}

// Two-option segmented pill for choosing inline vs block placement. A white
// pill-shaped track with a hairline border holds two equal segments; the
// selected one is filled grey and clips to the rounded edge (the track's
// `overflow: hidden` rounds the fill). Used by the embed chooser's preview
// pane footer.
const PlacementToggle: TOC<Signature> = <template>
  <div
    class='placement-toggle'
    role='group'
    aria-label='Embed placement'
    ...attributes
  >
    <button
      type='button'
      class='placement-toggle__option
        {{if (eq @selected "inline") "is-active"}}'
      aria-pressed='{{if (eq @selected "inline") "true" "false"}}'
      disabled={{@disabled}}
      data-test-markdown-embed-preview-inline
      {{on 'click' (fn @onChange 'inline')}}
    >
      Inline
    </button>
    <button
      type='button'
      class='placement-toggle__option {{if (eq @selected "block") "is-active"}}'
      aria-pressed='{{if (eq @selected "block") "true" "false"}}'
      disabled={{@disabled}}
      data-test-markdown-embed-preview-block
      {{on 'click' (fn @onChange 'block')}}
    >
      Block
    </button>
  </div>
  <style scoped>
    .placement-toggle {
      display: inline-flex;
      border: 1px solid var(--boxel-border-color);
      border-radius: 999px;
      background-color: var(--boxel-light);
      overflow: hidden;
    }
    .placement-toggle__option {
      appearance: none;
      border: none;
      background: transparent;
      padding: var(--boxel-sp-5xs) var(--boxel-sp);
      font: 600 var(--boxel-font-sm);
      color: var(--boxel-dark);
      cursor: pointer;
      line-height: 1.2;
      min-width: 3.5rem;
      flex: 1;
    }
    .placement-toggle__option.is-active {
      background-color: var(--boxel-200);
    }
    .placement-toggle__option:focus-visible {
      outline: 2px solid var(--boxel-highlight);
      outline-offset: -2px;
    }
    .placement-toggle__option:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  </style>
</template>;

export default PlacementToggle;
