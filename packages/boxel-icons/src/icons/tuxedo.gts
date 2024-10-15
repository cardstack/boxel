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
    class='lucide lucide-tuxedo'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M10 3v2l4-2v2Z' /><path
      d='M18 3h1a2 2 0 0 1 1.7 3A5270.5 5270.5 0 0 0 12 21S6.8 12 3.3 6A2 2 0 0 1 5 3h1M12 9h.01M12 13h.01'
    /><path d='M21 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'tuxedo';
export default IconComponent;