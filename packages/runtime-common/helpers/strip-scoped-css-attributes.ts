export default function stripScopedCSSAttributes(htmlString: string) {
  return htmlString.replace(/ data-scopedcss-[0-9a-f]{10}/g, '');
}
