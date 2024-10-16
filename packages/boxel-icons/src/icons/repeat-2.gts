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
    class='lucide lucide-repeat-2'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='m2 9 3-3 3 3' /><path
      d='M13 18H7a2 2 0 0 1-2-2V6M22 15l-3 3-3-3'
    /><path d='M11 6h6a2 2 0 0 1 2 2v10' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'repeat-2';
export default IconComponent;
