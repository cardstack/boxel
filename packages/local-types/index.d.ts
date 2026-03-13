import 'ember-source/types';
import 'ember-source/types/preview';
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
import '@glint/environment-ember-loose/registry';
import '@glint/environment-ember-loose/native-integration';
import { ComponentLike } from '@glint/template';
import 'ember-freestyle/glint';
import './eslint-js';

import type EmberAnimatedRegistry from 'ember-animated/template-registry';
import type EmberContextTemplateRegistry from 'ember-provide-consume-context/template-registry';

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry
    extends EmberContextTemplateRegistry,
      EmberAnimatedRegistry /* other addon registries */ {
    // local entries
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

import 'qunit';
import 'qunit-dom';

declare module '@cardstack/boxel-host/test-helpers' {
  export function renderCard(
    card: any,
    opts?: { commandContext?: any; format?: string },
  ): Promise<void>;
  export function visitOperatorMode(state?: {
    stacks?: Array<Array<{ id: string; format?: string }>>;
    submode?: string;
    [key: string]: unknown;
  }): Promise<void>;
  export function setupTestRealm(
    hooks: {
      beforeEach: (fn: () => Promise<void> | void) => void;
      afterEach: (fn: () => Promise<void> | void) => void;
    },
    options: { contents: Record<string, object>; realmURL?: string },
  ): void;
  export function fetchCard(url: string): Promise<any>;
  export function getDefaultWritableRealmURL(): string;
}
