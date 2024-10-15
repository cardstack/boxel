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
    class='lucide lucide-navigation-2-off'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M9.31 9.31 5 21l7-4 7 4-1.17-3.17M14.53 8.88 12 2l-1.17 3.17M2 2l20 20'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'navigation-2-off';
export default IconComponent;
