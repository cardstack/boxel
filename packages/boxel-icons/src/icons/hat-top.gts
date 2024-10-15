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
    class='lucide lucide-hat-top'
    viewBox='0 0 24 24'
    ...attributes
  ><ellipse cx='12' cy='5' rx='7' ry='3' /><path
      d='M5 5c0 1 1 4 1 6v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-2 1-5 1-6'
    /><path d='M18 11c0 1.7-2.7 3-6 3s-6-1.3-6-3' /><path
      d='M6 11.2C3.6 12.3 2 14 2 16c0 3.3 4.5 6 10 6s10-2.7 10-6c0-2-1.6-3.7-4-4.8'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'hat-top';
export default IconComponent;
