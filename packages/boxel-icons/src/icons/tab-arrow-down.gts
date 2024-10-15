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
    class='lucide lucide-tab-arrow-down'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M12 16V8M16 12l-4 4-4-4' /><path
      d='M4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M22 20H2'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'tab-arrow-down';
export default IconComponent;
