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
    class='lucide lucide-train-front-tunnel'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M2 22V12a10 10 0 1 1 20 0v10' /><path
      d='M15 6.8v1.4a3 2.8 0 1 1-6 0V6.8M10 15h.01M14 15h.01'
    /><path
      d='M10 19a4 4 0 0 1-4-4v-3a6 6 0 1 1 12 0v3a4 4 0 0 1-4 4ZM9 19l-2 3M15 19l2 3'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'train-front-tunnel';
export default IconComponent;
