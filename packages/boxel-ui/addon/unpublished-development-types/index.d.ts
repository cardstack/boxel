// Add any types here that you need for local development only.
// These will *not* be published as part of your addon, so be careful that your published code does not rely on them!

import '@glint/ember-tsc/types';

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
