import type { IconComponent } from './types.ts';

// boxel-icons' rectangle-ellipsis icon (lucide).
const RectangleEllipsis: IconComponent = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='20' height='12' x='2' y='6' rx='2' /><path
      d='M12 12h.01M17 12h.01M7 12h.01'
    /></svg>
</template>;

export default RectangleEllipsis;
