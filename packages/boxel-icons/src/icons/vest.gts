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
    class='lucide lucide-vest'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M10 4a2 2 0 0 0 4 0V3h4v3c0 1.7 1.3 3 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9c1.7 0 3-1.3 3-3V3h4Z'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'vest';
export default IconComponent;