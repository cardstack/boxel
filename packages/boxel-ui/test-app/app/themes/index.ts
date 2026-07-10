import { Bubblegum } from './bubblegum.ts';
import { NeoBrutalism } from './neo-brutalism.ts';
import { SoftPop } from './soft-pop.ts';
import { Candyland } from './candyland.ts';
import { Doom64 } from './doom64.ts';
import { StarryNight } from './starry-night.ts';
import { Boxel } from './boxel.ts';
import { DarkStudio } from './dark-studio.ts';

export interface Theme {
  cssVariables?: string;
  name: string;
}

export const THEMES = {
  Bubblegum,
  Doom64,
  SoftPop,
  NeoBrutalism,
  StarryNight,
  Candyland,
  DarkStudio,
  Boxel,
};

// adjust for freestyle doc styles overriding theme variables
const FREESTYLE_ADJUSTMENTS = `\n\n:root {\n  --theme-radius: var(--radius);\n}`;

const Themes: Theme[] = Object.entries(THEMES).map(([name, vars]) => ({
  name,
  cssVariables: vars + FREESTYLE_ADJUSTMENTS,
}));

export default Themes;
