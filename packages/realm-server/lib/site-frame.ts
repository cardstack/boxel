// The page's HTML inside the frame's, in the element <SitePage /> rendered.
// A frame with no such element is shown above the page.
export function framePage(
  frameHTML: string,
  pageHTML: string,
  doc: Document,
): string {
  let template = doc.createElement('template');
  template.innerHTML = frameHTML;
  let outlet = template.content.querySelector('[data-boxel-site-page]');
  if (!outlet) {
    return frameHTML + pageHTML;
  }
  outlet.innerHTML = pageHTML;
  return template.innerHTML;
}
