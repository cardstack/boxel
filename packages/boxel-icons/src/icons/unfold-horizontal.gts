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
    class='lucide lucide-unfold-horizontal'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M16 12h6M8 12H2M12 2v2M12 8v2M12 14v2M12 20v2M19 15l3-3-3-3M5 9l-3 3 3 3'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'unfold-horizontal';
export default IconComponent;
