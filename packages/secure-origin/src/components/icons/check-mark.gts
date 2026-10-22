import type { IconComponent } from './types.ts';

// boxel-ui's CheckMark icon.
const CheckMark: IconComponent = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='5 6 10.73 8'
    ...attributes
  ><path
      fill='none'
      stroke='var(--icon-color, #000)'
      stroke-linecap='round'
      stroke-linejoin='round'
      stroke-width='2'
      d='m14.727 7-6 6L6 10.273'
    /></svg>
</template>;

export default CheckMark;
