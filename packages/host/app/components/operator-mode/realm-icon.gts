import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { RealmInfo } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    realmInfo: RealmInfo;
  };
  Element: HTMLElement;
}

const RealmIcon: TemplateOnlyComponent<Signature> = <template>
  <img
    src={{@realmInfo.iconURL}}
    alt='Icon for workspace {{@realmInfo.name}}'
    data-test-realm-icon-url={{@realmInfo.iconURL}}
    ...attributes
  />
</template>;

export default RealmIcon;
