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
    class='lucide lucide-hand-metal'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M18 12.5V10a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1.4M14 11V9a2 2 0 1 0-4 0v2M10 10.5V5a2 2 0 1 0-4 0v9'
    /><path
      d='m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6C7.5 21.14 9.2 22 12 22h2a8 8 0 0 0 8-8V7a2 2 0 1 0-4 0v5'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'hand-metal';
export default IconComponent;