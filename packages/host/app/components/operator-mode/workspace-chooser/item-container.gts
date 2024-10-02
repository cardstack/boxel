import { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLButtonElement;
  Blocks: {
    default: [];
  };
}

const WorkspaceChooserItemContainer: TemplateOnlyComponent<Signature> =
  <template>
    <button class='workspace' ...attributes>
      {{yield}}
    </button>
    <style scoped>
      .workspace {
        min-width: 251.6px;
        width: 251.6px;
        height: 215.3px;
        display: flex;
        flex-direction: column;
        border-radius: 15px;
        border: solid 1px rgba(255, 255, 255, 0.5);
        overflow: hidden;
        padding: 0;
      }
    </style>
  </template>;

export default WorkspaceChooserItemContainer;
