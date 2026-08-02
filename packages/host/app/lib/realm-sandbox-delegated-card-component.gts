import Component from '@glimmer/component';

import RealmSandboxDelegatedRender from '@cardstack/host/components/realm-sandbox-delegated-render';

import type { BaseDef, BoxComponent, Format } from '@cardstack/base/card-api';

export default function realmSandboxDelegatedCardComponent(
  card: BaseDef,
): BoxComponent {
  return class RealmSandboxDelegatedCardComponent extends Component<{
    Element: HTMLElement;
    Args: { format?: Format; displayContainer?: boolean };
  }> {
    readonly card = card;

    <template>
      <RealmSandboxDelegatedRender
        @card={{this.card}}
        @format={{@format}}
        @displayContainer={{@displayContainer}}
        ...attributes
      />
    </template>
  } as unknown as BoxComponent;
}
