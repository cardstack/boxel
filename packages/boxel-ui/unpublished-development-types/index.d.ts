// Augment Glint's HTML element attributes with missing properties
declare global {
  // glimmer-scoped-css uses <style scoped> which isn't in Glint v2's type defs
  interface HTMLStyleElementAttributes {
    ['scoped']: string | boolean | null | undefined;
  }
  // Open Graph meta tags use <meta property="og:...">
  interface HTMLMetaElementAttributes {
    ['property']: string | null | undefined;
  }
}
