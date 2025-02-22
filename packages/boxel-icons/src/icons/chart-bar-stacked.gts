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
    class='lucide lucide-chart-bar-stacked'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M11 13v4M15 5v4M3 3v16a2 2 0 0 0 2 2h16' /><rect
      width='9'
      height='4'
      x='7'
      y='13'
      rx='1'
    /><rect width='12' height='4' x='7' y='5' rx='1' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'chart-bar-stacked';
export default IconComponent;
