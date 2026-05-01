import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { IconInherit as InheritIcon } from '@cardstack/boxel-ui/icons';

export interface Signature {
  Args: { label: string };
  Element: HTMLElement;
}

export const Divider: TemplateOnlyComponent<Signature> = <template>
  <div class='divider-group' ...attributes>
    <hr class='divider' />
    <div class='divider-label'>
      <InheritIcon width='10' height='18' role='presentation' />
      {{@label}}
    </div>
  </div>
  <style scoped>
    .divider-group {
      position: relative;
      padding: var(--boxel-sp) 0;
    }
    .divider {
      width: 100%;
      margin: 0;
      border: 1px solid var(--divider-border-color, #707070);
    }
    .divider-label {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translateX(-50%) translateY(-50%);
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-xxxs);
      padding: 0 var(--boxel-sp-xxxs);
      background-color: var(--boxel-200);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--divider-content-lsp, var(--boxel-lsp-xs));
      text-wrap: nowrap;
      /* InheritIcon's fill is var(--icon-color, #000). Without this override
         the icon inherits --icon-color from the operator-mode container,
         which resolves to near-white and vanishes on the light divider
         background. Pinning it here makes the icon deterministic. */
      --icon-color: var(--boxel-dark);
    }
  </style>
</template>;
