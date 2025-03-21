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
    class='icon icon-tabler icons-tabler-outline icon-tabler-rotate-360'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path d='M12 16h4v4' /><path
      d='M19.458 11.042c.86-2.366.722-4.58-.6-5.9-2.272-2.274-7.185-1.045-10.973 2.743-3.788 3.788-5.017 8.701-2.744 10.974 2.227 2.226 6.987 1.093 10.74-2.515'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'rotate-360';
export default IconComponent;
