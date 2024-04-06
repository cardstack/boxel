import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Args: {
    realmIconURL: string | null;
    realmName: string | undefined;
  };
  Element: HTMLElement;
}

const RealmIcon: TemplateOnlyComponent<Signature> = <template>
  <img
    src={{@realmIconURL}}
    alt='Icon for workspace {{@realmName}}'
    data-test-realm-icon-url={{@realmIconURL}}
    ...attributes
  />
</template>;

export default RealmIcon;
