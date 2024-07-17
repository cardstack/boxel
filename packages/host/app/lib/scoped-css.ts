import { decodeScopedCSSRequest } from 'glimmer-scoped-css';

export function getScopedCss(source: string): string {
  let matches = source.matchAll(
    /import ['"]([^"']+\.glimmer-scoped.css)['"];/g,
  );
  let moduleCss: string[] = [];
  for (let match of matches) {
    let request = match[1];
    let { css } = decodeScopedCSSRequest(request);
    moduleCss.push(css);
  }
  return moduleCss.join('\n').trim();
}
