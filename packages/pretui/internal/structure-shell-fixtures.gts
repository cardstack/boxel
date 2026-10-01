// Pretui — fixtures shared by the structure-shell usage pages.
import { PLACES, TEAS, seedFrom, take } from '../examples';

export 
const SHELL_SEED = seedFrom('pretui-shell-demo');

export 
interface NavRow {
  id: string;
  label: string;
  badge?: string;
}

export 
const LIBRARY: NavRow[] = take(SHELL_SEED, 0, 4, TEAS).map((tea, i) => ({
  id: 'lib-' + i,
  label: tea,
  badge: String(4 + (seedFrom('nav#' + tea) % 40)),
}));

export 
const ORIGINS: NavRow[] = take(SHELL_SEED, 1, 3, PLACES).map((place, i) => ({
  id: 'org-' + i,
  label: place,
}));
