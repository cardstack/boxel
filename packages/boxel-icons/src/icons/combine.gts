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
    class='lucide lucide-combine'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M10 18H5a3 3 0 0 1-3-3v-1M14 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2M20 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2'
    /><path d='m7 21 3-3-3-3' /><rect
      width='8'
      height='8'
      x='14'
      y='14'
      rx='2'
    /><rect width='8' height='8' x='2' y='2' rx='2' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'combine';
export default IconComponent;
