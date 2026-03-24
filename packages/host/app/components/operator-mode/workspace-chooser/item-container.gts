import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
        min-width: 250px;
        width: 250px;
        height: 166px;
        display: flex;
        flex-direction: column;
        border-radius: 15px;
        border: none;
        overflow: hidden;
        padding: 0;
        position: relative;
      }
      .workspace::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 15px;
        border: 1px solid var(--item-container-border-color, rgba(255 255 255 / 15%));
        pointer-events: none;
        z-index: 2;
      }
      .workspace:hover::after {
        border-color: var(--item-container-border-hover-color, rgba(255 255 255 / 40%));
      }
      .workspace:focus-visible {
        outline-offset: -1px;
      }
    </style>
  </template>;

export default WorkspaceChooserItemContainer;
