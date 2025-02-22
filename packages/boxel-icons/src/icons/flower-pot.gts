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
    class='lucide lucide-flower-pot'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M9 8h1M12 5v1M15 8h-1' /><circle cx='12' cy='8' r='2' /><path
      d='M12 11a3 3 0 1 1-3-3 3 3 0 1 1 3-3 3 3 0 1 1 3 3 3 3 0 1 1-3 3M12 10v8M15 18l-1 4h-4l-1-4M8 18h8'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'flower-pot';
export default IconComponent;
