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
    class='lucide lucide-burger'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M5 12a2 2 0 0 1-2-2 9 7 0 0 1 18 0 2 2 0 0 1-2 2l-3.5 4.1c-.8 1-2.4 1.1-3.4.3L7 12'
    /><path
      d='M11.7 16H4a2 2 0 0 1 0-4h16a2 2 0 0 1 0 4h-4.3M5 16a2 2 0 0 0-2 2c0 1.7 1.3 3 3 3h12c1.7 0 3-1.3 3-3a2 2 0 0 0-2-2'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'burger';
export default IconComponent;
