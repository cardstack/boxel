import { scroll } from 'glimmer-motion/scroll';
import { easeIn } from '@cardstack/choreo/easings';

// Both modules exist and are published subpaths, but the host doesn't
// shim them, so a card importing them would fail to load. parse has to
// report them as unresolved rather than type-check them clean.
export const used = [scroll, easeIn];
