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
    class='lucide lucide-house-off'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M21 15.3V9l-9-7-2.4 1.9M2 2l20 20M6.4 6.4 3 9v11a2 2 0 0 0 2 2h14a2 2 0 0 0 1.8-1.2'
    /><path d='M12 12H9v10M15 22v-7' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'house-off';
export default IconComponent;
