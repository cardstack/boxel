import { module, test } from 'qunit';

import { VirtualNetwork, rri } from '@cardstack/runtime-common';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import {
  isComponentDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/services/module-contents-service';

const REAL_BASE = 'https://realms.example.test/base/';
const ALIAS_BASE = 'https://cardstack.com/base/';
const REAL_TEST = 'https://realms.example.test/test/';

module('Unit | isComponentDeclaration', function () {
  function configuredNetwork() {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(new URL(ALIAS_BASE), new URL(REAL_BASE));
    virtualNetwork.addRealmMapping('@cardstack/base/', REAL_BASE);
    return virtualNetwork;
  }

  async function declarationFor(
    src: string,
    name: string,
    virtualNetwork: VirtualNetwork,
  ): Promise<ModuleDeclaration> {
    let syntax = await ModuleSyntax.create(
      src,
      rri(`${REAL_TEST}example`),
      virtualNetwork,
    );
    let declaration = syntax.declarations.find((d) => d.localName === name);
    if (!declaration) {
      throw new Error(`no declaration named ${name}`);
    }
    return declaration as ModuleDeclaration;
  }

  test('recognises a Component imported from @cardstack/base/card-api', async function (assert) {
    let virtualNetwork = configuredNetwork();
    let declaration = await declarationFor(
      `import { Component } from '@cardstack/base/card-api';
       export class Widget extends Component {}`,
      'Widget',
      virtualNetwork,
    );
    assert.true(isComponentDeclaration(declaration, virtualNetwork));
  });

  test('recognises a Component imported from the legacy base URL', async function (assert) {
    let virtualNetwork = configuredNetwork();
    let declaration = await declarationFor(
      `import { Component } from '${ALIAS_BASE}card-api';
       export class Widget extends Component {}`,
      'Widget',
      virtualNetwork,
    );
    assert.true(isComponentDeclaration(declaration, virtualNetwork));
  });

  test('recognises a Glimmer component', async function (assert) {
    let virtualNetwork = configuredNetwork();
    let declaration = await declarationFor(
      `import GlimmerComponent from '@glimmer/component';
       export class Widget extends GlimmerComponent {}`,
      'Widget',
      virtualNetwork,
    );
    assert.true(isComponentDeclaration(declaration, virtualNetwork));
  });

  test('rejects a Component imported from another module', async function (assert) {
    let virtualNetwork = configuredNetwork();
    let declaration = await declarationFor(
      `import { Component } from '@cardstack/base/field-component';
       export class Widget extends Component {}`,
      'Widget',
      virtualNetwork,
    );
    assert.false(isComponentDeclaration(declaration, virtualNetwork));
  });
});
