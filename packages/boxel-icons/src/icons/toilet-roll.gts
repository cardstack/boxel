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
    class='lucide lucide-toilet-roll'
    viewBox='0 0 24 24'
    ...attributes
  ><ellipse cx='10' cy='8' rx='3' ry='2' /><ellipse
      cx='10'
      cy='8'
      rx='7'
      ry='6'
    /><path
      d='M3 8v8c0 3.3 3.1 6 7 6s7-2.7 7-6V8c0 2.2 2.2 4 5 4v8c-2.8 0-5-1.8-5-4M10 14v2M10 20v2'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'toilet-roll';
export default IconComponent;
