import * as CS_THEMES from './cs-themes.ts';
import * as TCN_THEMES from './tcn-themes.ts';

const THEMES = { ...TCN_THEMES, ...CS_THEMES };

export interface Theme {
  cssVariables?: string;
  name: string;
}

// adjust for freestyle doc styles overriding theme variables
const FREESTYLE_ADJUSTMENTS = `\n\n:root {\n  --theme-radius: var(--radius);\n}`;

// PascalCase export name -> display name, e.g.
// "AmethystHaze" -> "Amethyst Haze", "Doom64" -> "Doom 64"
function formatThemeName(name: string): string {
  return name
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');
}

const Themes: Theme[] = Object.entries(THEMES).map(([name, vars]) => ({
  name: formatThemeName(name),
  cssVariables: vars + FREESTYLE_ADJUSTMENTS,
}));

export default Themes;
