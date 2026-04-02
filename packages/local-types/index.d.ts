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
import type { HelperLike, ModifierLike } from '@glint/template';
import type { ConcatHelper as GlintConcatHelper } from '@glint/ember-tsc/-private/intrinsics/concat';
import type { FnHelper as GlintFnHelper } from '@glint/ember-tsc/-private/intrinsics/fn';
import type { LinkToComponent as GlintLinkToComponent } from '@glint/ember-tsc/-private/intrinsics/link-to';
import type {
  EventForName,
  OnModifierArgs,
} from '@glint/ember-tsc/-private/intrinsics/on';
import { Invoke, InvokeDirect } from '@glint/template/-private/integration';
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

// Ember's exported template intrinsics (`fn`, `concat`, `on`) are currently
// typed in `ember-source` as opaque runtime values. Glint does load its ambient
// integration declarations, but in this repo's Glint v2 setup those merges do
// not fully carry through to the actual exported value types used by `.gts`
// template-import syntax. The result is widespread `TS2769` errors like
// "Argument of type 'FnHelper' is not assignable to parameter of type
// 'DirectInvokable'" when using basic Ember template functionality.
//
// This shim re-attaches the Glint-invokable shape to those existing Ember
// exports. It is a compatibility patch for the current Ember/Glint typing
// combination, not a new API surface.
declare module '@ember/helper' {
  interface FnHelper {
    [InvokeDirect]: GlintFnHelper[typeof InvokeDirect];
  }

  interface ConcatHelper extends GlintConcatHelper, HelperLike<{
    Args: { Positional: unknown[] };
    Return: string;
  }> {}
}

declare module '@ember/modifier/on' {
  interface OnModifier
    extends ModifierLike<{
      Element: Element;
      Args: {
        Named: OnModifierArgs;
        Positional: [name: string, callback: (event: EventForName<string>) => void];
      };
    }> {}
}

// `@ember/routing` re-exports `LinkTo` from `@ember/-internals/glimmer`, where
// Ember still declares it as an opaque internal component constructor. In this
// setup the Glint augmentation on `@ember/routing` alone does not flow through
// to the re-exported value type, so imported `<LinkTo>` still lacks
// `[InvokeDirect]` and fails in `.gts`.
declare module '@ember/-internals/glimmer/lib/components/link-to' {
  interface LinkTo {
    [InvokeDirect]: InstanceType<GlintLinkToComponent>[typeof Invoke];
  }
}

declare module '@ember/-internals/glimmer' {
  interface LinkTo {
    [InvokeDirect]: InstanceType<GlintLinkToComponent>[typeof Invoke];
  }
}

declare module '@ember/routing' {
  interface LinkTo {
    [InvokeDirect]: InstanceType<GlintLinkToComponent>[typeof Invoke];
  }
}

// runtime-common has its own global type declaration that we need to
// incorporate
import '../../runtime-common/global';

import './matrix-js-sdk';
