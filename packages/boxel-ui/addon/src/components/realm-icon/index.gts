import type { TemplateOnlyComponent } from '@ember/component/template-only';

export type RealmDisplayInfo = {
  iconURL: string | null;
  name: string;
};

interface Signature {
  Args: {
    realmInfo: RealmDisplayInfo;
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
