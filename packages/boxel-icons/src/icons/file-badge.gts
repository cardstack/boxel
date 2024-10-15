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
    class='lucide lucide-file-badge'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3' /><path
      d='M14 2v4a2 2 0 0 0 2 2h4M5 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
    /><path d='M7 16.5 8 22l-3-1-3 1 1-5.5' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'file-badge';
export default IconComponent;
