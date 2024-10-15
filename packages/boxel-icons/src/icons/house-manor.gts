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
    class='lucide lucide-house-manor'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M9 6V2H5v4M19 6V2h-4v4' /><rect
      width='20'
      height='16'
      x='2'
      y='6'
      rx='2'
    /><path
      d='M2 12h4M6 22V12l5.5-6M12.5 6l5.5 6v10M18 12h4M12 11h.01M10 22v-5a2 2 0 1 1 4 0v5'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'house-manor';
export default IconComponent;