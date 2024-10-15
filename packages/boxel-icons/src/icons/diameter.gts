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
    class='lucide lucide-diameter'
    viewBox='0 0 24 24'
    ...attributes
  ><circle cx='19' cy='19' r='2' /><circle cx='5' cy='5' r='2' /><path
      d='M6.48 3.66a10 10 0 0 1 13.86 13.86M6.41 6.41l11.18 11.18M3.66 6.48a10 10 0 0 0 13.86 13.86'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'diameter';
export default IconComponent;