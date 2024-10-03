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
    class='lucide lucide-cable-car'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M10 3h.01M14 2h.01M2 9l20-5M12 12V6.5' /><rect
      width='16'
      height='10'
      x='4'
      y='12'
      rx='3'
    /><path d='M9 12v5M15 12v5M4 17h16' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'cable-car';
export default IconComponent;