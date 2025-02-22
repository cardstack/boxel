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
    class='lucide lucide-align-start-vertical'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='9' height='6' x='6' y='14' rx='2' /><rect
      width='16'
      height='6'
      x='6'
      y='4'
      rx='2'
    /><path d='M2 2v20' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'align-start-vertical';
export default IconComponent;
