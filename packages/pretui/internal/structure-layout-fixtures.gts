// Pretui — fixtures shared by the structure-layout usage pages.
import { PLACES, TEAS, seedFrom, take } from '../examples';

export 
const LAYOUT_SEED = seedFrom('pretui-layout-demo');

export 
interface Lot {
  id: string;
  tea: string;
  place: string;
  chests: number;
}

export 
const LOTS: Lot[] = take(LAYOUT_SEED, 0, 5, TEAS).map((tea, i) => ({
  id: 'B-' + (201 + i),
  tea,
  place: PLACES[(seedFrom(tea) + i) % PLACES.length] as string,
  chests: 20 + (seedFrom('layout#' + tea) % 180),
}));

export 
// A deterministic, network-free image. Two flat bands and a disc, so the
// difference between `contain` and `cover` is visible at a glance.
const SWATCH =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    [
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>",
      "<rect width='320' height='180' fill='%23274b45'/>",
      "<rect y='120' width='320' height='60' fill='%23c8d6c0'/>",
      "<circle cx='236' cy='62' r='34' fill='%23e8c06a'/>",
      '</svg>',
    ].join(''),
  );
