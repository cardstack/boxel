import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import type RealmSandboxStylesService from '@cardstack/host/services/realm-sandbox-styles';

import type { ArgsFor, PositionalArgs } from 'ember-modifier';

interface Signature {
  Element: Element;
  Args: {
    Positional: [stylesheets: readonly string[]];
  };
}

export default class RealmSandboxStyles extends Modifier<Signature> {
  @service('realm-sandbox-styles')
  declare private styles: RealmSandboxStylesService;
  private release?: () => void;
  private stylesheets?: readonly string[];

  constructor(owner: Owner, args: ArgsFor<Signature>) {
    super(owner, args);
    registerDestructor(this, () => this.release?.());
  }

  modify(_element: Element, [stylesheets]: PositionalArgs<Signature>) {
    if (
      this.stylesheets?.length === stylesheets.length &&
      this.stylesheets.every((stylesheet, index) =>
        Object.is(stylesheet, stylesheets[index]),
      )
    ) {
      return;
    }
    // Acquire the next generation before releasing the previous one. Shared
    // CSS therefore keeps the exact same <style> node and never disappears for
    // a frame during a compatible hot update.
    let nextRelease = this.styles.acquire(stylesheets);
    let previousRelease = this.release;
    this.release = nextRelease;
    this.stylesheets = stylesheets;
    previousRelease?.();
  }
}
