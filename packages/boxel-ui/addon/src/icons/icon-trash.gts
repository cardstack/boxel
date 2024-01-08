// This file is auto-generated by 'pnpm rebuild:icons'
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Signature } from './types.ts';

const IconComponent: TemplateOnlyComponent<Signature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='13.7'
    height='15'
    viewBox='0 0 13.7 15'
    ...attributes
  ><g
      fill='none'
      stroke='var(--icon-color, #000)'
      stroke-linecap='round'
      stroke-linejoin='round'
      stroke-width='var(--icon-stroke-width, 1px)'
    ><path
        d='M1 3.6h11.7M11.4 3.6v9.1a1.3 1.3 0 0 1-1.3 1.3H3.6a1.3 1.3 0 0 1-1.3-1.3V3.6m1.95 0V2.3A1.3 1.3 0 0 1 5.55 1h2.6a1.3 1.3 0 0 1 1.3 1.3v1.3'
      /><path stroke-width='1' d='M5.55 6.85v3.9M8.15 6.85v3.9' /></g></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'IconTrash';
export default IconComponent;
