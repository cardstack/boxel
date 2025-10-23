export function cleanCapturedHTML(html: string): string {
  if (!html) {
    return html;
  }
  const emberIdAttr = /\s+id=(?:"ember\d+"|'ember\d+'|ember\d+)(?=[\s>])/g;
  const emptyDataAttr = /\s+(data-[A-Za-z0-9:_-]+)=(?:""|''|(?=[\s>]))/g;
  let cleaned = html.replace(emberIdAttr, '');
  cleaned = cleaned.replace(emptyDataAttr, ' $1');
  return cleaned;
}
