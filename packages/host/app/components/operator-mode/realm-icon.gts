import Component from '@glimmer/component';

interface Signature {
  Args: {
    realmIconURL: string | null;
    realmName: string | undefined;
  };
  Element: HTMLElement;
}

export default class RealmIcon extends Component<Signature> {
  <template>
    <img
      src={{@realmIconURL}}
      alt='Icon for workspace {{@realmName}}'
      data-test-realm-icon-url={{@realmIconURL}}
      ...attributes
    />
  </template>
}
