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
    class='lucide lucide-arrow-down-z-a'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='m3 16 4 4 4-4M7 4v16M15 4h5l-5 6h5M15 20v-3.5a2.5 2.5 0 0 1 5 0V20M20 18h-5'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'arrow-down-z-a';
export default IconComponent;
