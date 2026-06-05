import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn } from '@cardstack/boxel-ui/helpers';

// AdornLabel: the teal flag-tab type label. Renders an outer div
// shaped like a flag (sloped right edge, rounded left corners), with
// named-block slots for an optional icon, the required type-name
// text, and an optional in-tab dropdown menu.
//
// All inner content classes (`.adorn-label-icon-slot`,
// `.adorn-label-text`, `.adorn-label-dropdown`) are rendered by this
// component, so the scoped CSS below applies without needing
// `:global()`. The slot wrappers cascade their size to whatever
// content the consumer yields (typically an SVG icon, a string of
// text, and a BoxelDropdown).
//
// `@compact` switches to a smaller variant used inside narrow
// containers (e.g. operator-mode's atom-format cards).
//
// `data-side="bottom"` mirrors the clip-path vertically — used by
// operator-mode when there isn't room above the card and the label
// flips below.
//
// Positioning is the consumer's responsibility. Background reads
// `--adorn-label-bg` so an ancestor can swap to the darker accent
// when the underlying card is selected.
export interface AdornLabelSignature {
  Args: {
    compact?: boolean;
  };
  Element: HTMLDivElement;
  Blocks: {
    icon?: [];
    text: [];
    dropdown?: [];
  };
}

const AdornLabel: TemplateOnlyComponent<AdornLabelSignature> = <template>
  <div
    class={{cn
      'adorn-label'
      compact=@compact
      no-menu=(unless (has-block 'dropdown') true)
    }}
    ...attributes
  >
    {{#if (has-block 'icon')}}
      <span class='adorn-label-icon-slot'>{{yield to='icon'}}</span>
    {{/if}}
    <span class='adorn-label-text'>{{yield to='text'}}</span>
    {{#if (has-block 'dropdown')}}
      <span class='adorn-label-dropdown'>{{yield to='dropdown'}}</span>
    {{/if}}
  </div>
  <style scoped>
    .adorn-label {
      display: inline-flex;
      align-items: center;
      gap: 0.3125rem;
      padding: 0.1875rem 0.75rem 0.1875rem 0.4375rem;
      background: var(--adorn-label-bg, var(--adorn-accent-light));
      color: var(--boxel-highlight-foreground);
      font: 700 0.625rem/1 var(--boxel-font-family, inherit);
      letter-spacing: 0.5px;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      border-radius: 0.3125rem 0 0 0.3125rem;
      clip-path: polygon(0 0, calc(100% - 0.8125rem) 0, 100% 100%, 0 100%);
      z-index: 1;
    }
    /* Mirrored polygon when the label flips below the card so the
       slope still points toward the card edge. */
    .adorn-label[data-side='bottom'] {
      clip-path: polygon(0 100%, calc(100% - 0.8125rem) 100%, 100% 0, 0 0);
    }
    .adorn-label.compact {
      padding: 0.125rem 0.625rem 0.125rem 0.3125rem;
      font-size: 0.5625rem;
      gap: 0.25rem;
    }
    /* Without an in-tab menu filling the right side, the text would
       crowd the flag's sloped right edge — add clearance so it clears
       the slope. */
    .adorn-label.no-menu {
      padding-right: 1.125rem;
    }
    .adorn-label.no-menu.compact {
      padding-right: 0.9375rem;
    }

    .adorn-label-icon-slot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 0.875rem;
      height: 0.875rem;
      color: var(--boxel-highlight-foreground);
    }
    .adorn-label.compact .adorn-label-icon-slot {
      width: 0.6875rem;
      height: 0.6875rem;
    }
    /* Cascade the slot's size to whatever the consumer puts inside
       (typically an SVG icon), so they don't have to size it
       themselves. */
    .adorn-label-icon-slot > * {
      width: 100%;
      height: 100%;
    }

    .adorn-label-text {
      /* `min-width: 0` lets the flex item shrink below its
         min-content size when the label is capped by a max-width;
         without it, text-overflow:ellipsis can't kick in. */
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* In-tab menu slot. Inline-flex so the menu trigger and its
       portal-origin element count as a single flex item of the
       label. Otherwise the label's natural width grows by one
       flex-gap when the menu opens (the open-state wormhole-origin
       becomes a flex item where the closed-state placeholder was
       display:none), shifting the label on every menu open/close. */
    .adorn-label-dropdown {
      display: inline-flex;
      align-items: center;
    }
  </style>
</template>;

export default AdornLabel;
