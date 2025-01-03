// This file is auto-generated by 'pnpm rebuild:all'
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Signature } from '../types.ts';

const IconComponent: TemplateOnlyComponent<Signature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='24'
    height='24'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    class='icon icon-tabler icons-tabler-outline icon-tabler-meter-cube'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M17 5h1.5a1.5 1.5 0 0 1 0 3H18h.5a1.5 1.5 0 0 1 0 3H17M4 12v6M4 14a2 2 0 0 1 2-2h.5A2.5 2.5 0 0 1 9 14.5V18M9 15.5v-1a2.5 2.5 0 1 1 5 0V18'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'meter-cube';
export default IconComponent;
