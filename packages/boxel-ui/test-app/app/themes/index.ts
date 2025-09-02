import {
  extractCssVariables,
  getStyleConversions,
} from '@cardstack/boxel-ui/helpers';

import { Bubblegum } from './bubblegum.ts';
import { NeoBrutalism } from './neo-brutalism.ts';
import { SoftPop } from './soft-pop.ts';
import { Candyland } from './candyland.ts';
import { Doom64 } from './doom64.ts';
import { StarryNight } from './starry-night.ts';
import { Boxel } from './boxel.ts';

export interface Theme {
  name: string;
  styles?: string;
}

export const THEMES = {
  Bubblegum,
  Doom64,
  SoftPop,
  NeoBrutalism,
  StarryNight,
  Candyland,
  Boxel,
};

function getThemeStyles(cssString: string) {
  if (!extractCssVariables) {
    return;
  }
  return [getStyleConversions(), extractCssVariables(cssString)]
    .filter(Boolean)
    .join('');
}

const Themes: Theme[] = Object.entries(THEMES).map(([name, vars]) => ({
  name,
  styles: getThemeStyles(vars),
}));

export default Themes;
