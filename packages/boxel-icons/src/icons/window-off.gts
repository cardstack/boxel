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
    class='icon icon-tabler icons-tabler-outline icon-tabler-window-off'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M6.166 6.19A6.903 6.903 0 0 0 5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1m0-4v-5c0-3.728-3.134-7-7-7a6.86 6.86 0 0 0-3.804 1.158M5 13h8m4 0h2M12 3v5m0 4v9M3 3l18 18'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'window-off';
export default IconComponent;