import {
  fontStacksFromCss,
  googleFontImportUrl,
  webFontFamiliesFrom,
} from '@cardstack/boxel-ui/helpers';

export function loadThemeFonts(cssVariables: string): void {
  for (let family of webFontFamiliesFrom(fontStacksFromCss(cssVariables))) {
    let id = `theme-font-${family.toLowerCase().replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) {
      continue;
    }
    let link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = googleFontImportUrl(family);
    document.head.append(link);
  }
}
