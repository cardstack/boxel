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
    class='lucide lucide-kiwi'
    viewBox='0 0 24 24'
    ...attributes
  ><circle cx='12' cy='12' r='10' /><path
      d='M12 6v1M15 9l1-1M17 12h1M15 15l1 1M12 17v1M8 16l1-1M6 12h1M8 8l1 1'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'kiwi';
export default IconComponent;
