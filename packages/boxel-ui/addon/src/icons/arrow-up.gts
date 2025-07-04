// This file is auto-generated by 'pnpm rebuild:icons'
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Signature } from './types.ts';

const IconComponent: TemplateOnlyComponent<Signature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='17.536'
    height='16.5'
    viewBox='-17.536 -16.5 17.536 16.5'
    ...attributes
  ><g
      fill='none'
      stroke='var(--icon-color, #000)'
      stroke-linecap='round'
      stroke-linejoin='round'
      stroke-width='var(--stroke-width, 2.5)'
      style='transform:translateX(-17.35px) rotate(-90deg)'
    ><path d='M1.25 8.768h14M8.25 1.768l7 7-7 7' /></g></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'ArrowUp';
export default IconComponent;
