import 'ember-source/types';
import * as ContentTag from 'content-tag';

declare global {
  // Make ContentTagGlobal a property of globalThis
  interface Window {
    ContentTagGlobal: typeof ContentTag;
  }

  interface globalThis {
    ContentTagGlobal: typeof ContentTag;
  }

  // For Node.js environments
  let ContentTagGlobal: typeof ContentTag;
}

import { TemplateFactory } from 'htmlbars-inline-precompile';
import '@glint/ember-tsc/types';
import { ComponentLike } from '@glint/template';
import './eslint-js';

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

// Types for compiled templates
declare module '@cardstack/host/templates/*' {
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare module '@ember/component' {
  export function setComponentTemplate<T extends ComponentLike>(
    template: string,
    Component: T,
  ): T;
}

// runtime-common has its own global type declaration that we need to
// incorporate
import '../../runtime-common/global';

import './matrix-js-sdk';
