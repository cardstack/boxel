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
    class='lucide lucide-chart-candlestick'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M9 5v4' /><rect width='4' height='6' x='7' y='9' rx='1' /><path
      d='M9 15v2M17 3v2'
    /><rect width='4' height='8' x='15' y='5' rx='1' /><path
      d='M17 13v3M3 3v16a2 2 0 0 0 2 2h16'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'chart-candlestick';
export default IconComponent;