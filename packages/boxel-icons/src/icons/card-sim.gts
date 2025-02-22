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
    class='lucide lucide-card-sim'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2Z' /><rect
      width='8'
      height='8'
      x='8'
      y='10'
      rx='2'
    /><path d='M8 14h8M12 14v4' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'card-sim';
export default IconComponent;
