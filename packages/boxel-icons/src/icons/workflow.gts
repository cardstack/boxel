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
    class='lucide lucide-workflow'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='8' height='8' x='3' y='3' rx='2' /><path
      d='M7 11v4a2 2 0 0 0 2 2h4'
    /><rect width='8' height='8' x='13' y='13' rx='2' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'workflow';
export default IconComponent;
