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
    class='icon icon-tabler icons-tabler-outline icon-tabler-message-2-heart'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M8 9h8M8 13h3.5M10.5 19.5 9 18H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4'
    /><path
      d='m18 22 3.35-3.284a2.143 2.143 0 0 0 .005-3.071 2.242 2.242 0 0 0-3.129-.006l-.224.22-.223-.22a2.242 2.242 0 0 0-3.128-.006 2.143 2.143 0 0 0-.006 3.071L18 22z'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'message-2-heart';
export default IconComponent;