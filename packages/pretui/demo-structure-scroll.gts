// Pretui — demo-structure-scroll: the lot fixtures the Carousel and Scroller usage pages share.
import { PLACES, TEAS, seedFrom, take } from './examples';

const SCROLL_SEED = seedFrom('pretui-scroll-demo');

interface Lot {
  id: string;
  tea: string;
  place: string;
  chests: number;
}

export const LOTS: Lot[] = take(SCROLL_SEED, 0, 9, TEAS).map((tea, i) => ({
  id: 'B-' + (101 + i),
  tea,
  place: PLACES[(seedFrom(tea) + i) % PLACES.length] as string,
  chests: 20 + (seedFrom('lot#' + tea) % 180),
}));

