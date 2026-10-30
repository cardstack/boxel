import type { TemplateOnlyComponent } from '@ember/component/template-only';

import SquareDashedMousePointer from '@cardstack/boxel-icons/square-dashed-mouse-pointer';

import { Pill } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    label?: string;
    metaPills?: string[]; // e.g. ["Schema", "Lines 51–78"]
  };
}

let FocusPill: TemplateOnlyComponent<Signature> = <template>
  <Pill
    class='ai-focus-pill'
    @variant='muted'
    data-test-focus-pill-main
    ...attributes
  >
    <:iconLeft>
      <SquareDashedMousePointer width='16' height='16' />
    </:iconLeft>
    <:default>
      <span class='boxel-ellipsize' title={{@label}}>{{@label}}</span>
      {{#each @metaPills as |metaPill|}}
        <Pill
          class='meta-pill boxel-ellipsize'
          @pillBackgroundColor='#777'
          data-test-focus-pill-meta
        >
          {{metaPill}}
        </Pill>
      {{/each}}
    </:default>
  </Pill>

  <style scoped>
    .ai-focus-pill {
      --boxel-pill-border: none;
      --boxel-pill-border-radius: var(--boxel-border-radius-sm);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      height: 1.875rem;
      padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
      gap: var(--boxel-sp-xxs);
    }
    .ai-focus-pill:hover {
      filter: brightness(0.95);
    }

    .meta-pill {
      flex-shrink: 0;
      height: 1.375rem;
      padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
      font-size: var(--boxel-font-size-2xs);
      line-height: var(--boxel-line-height-xs);
      font-variant-numeric: tabular-nums;
      border-radius: var(--boxel-border-radius-xs);
    }
  </style>
</template>;

export default FocusPill;
