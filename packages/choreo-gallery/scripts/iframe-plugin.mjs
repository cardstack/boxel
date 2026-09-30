/** Boxel-only adaptations; the Pages build continues to consume unmodified sources. */
export function boxelIframe() {
  return {
    name: 'boxel-iframe-adapter',
    enforce: 'pre',
    transform(code, id) {
      if (
        process.env.CHOREO_BOXEL_BUILD !== '1' ||
        !id.includes('/choreo-test-app/app/') ||
        !/\.(gts|ts)(\?|$)/.test(id)
      ) {
        return;
      }
      let next = code.replace(
        /\b(?:window\.)?location\.search/g,
        '(window.location.search || window.location.hash.slice(window.location.hash.indexOf("?")))',
      );
      if (/\/(sagrada-film|tower-film)\.gts/.test(id)) {
        next = next.replace(
          '  get src(): string {',
          '  get pictureSource(): string | undefined { return (window as unknown as { __choreoPicture?: string }).__choreoPicture || undefined; }\n  get src(): string {',
        );
        next = next.replace(
          '@src={{this.src}}',
          '@src={{this.src}}\n          @srcdoc={{this.pictureSource}}',
        );
      }
      return next === code ? null : { code: next, map: null };
    },
  };
}
