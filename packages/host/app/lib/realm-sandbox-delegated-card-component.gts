import Component from '@glimmer/component';

import type { CodeRef } from '@cardstack/runtime-common';

import RealmSandboxDelegatedRender from '@cardstack/host/components/realm-sandbox-delegated-render';

import type { BaseDef, BoxComponent, Format } from '@cardstack/base/card-api';

export default function realmSandboxDelegatedCardComponent(
  card: BaseDef,
  codeRef?: CodeRef,
): BoxComponent {
  return class RealmSandboxDelegatedCardComponent extends Component<{
    Element: HTMLElement;
    Args: { format?: Format; displayContainer?: boolean };
  }> {
    readonly card = card;
    readonly codeRef = codeRef;

    <template>
      <RealmSandboxDelegatedRender
        @card={{this.card}}
        @codeRef={{this.codeRef}}
        @format={{@format}}
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    </template>
  } as unknown as BoxComponent;
}
