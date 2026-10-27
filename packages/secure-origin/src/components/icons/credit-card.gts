import type { IconComponent } from './types.ts';

// boxel-icons' credit-card icon (lucide).
const CreditCard: IconComponent = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='20' height='14' x='2' y='5' rx='2' /><line
      x1='2'
      x2='22'
      y1='10'
      y2='10'
    /></svg>
</template>;

export default CreditCard;
