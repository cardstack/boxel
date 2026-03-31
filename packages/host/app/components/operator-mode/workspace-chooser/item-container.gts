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
        min-width: var(--boxel-xxs-container);
        width: var(--boxel-xxs-container);
        height: 10.375rem;
        display: flex;
        flex-direction: column;
        border-radius: var(--boxel-border-radius-xl);
        border: none;
        overflow: hidden;
        padding: 0;
        position: relative;
      }
      .workspace::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: var(--boxel-border-radius-xl);
        border: 1px solid
          var(--item-container-border-color, rgba(255 255 255 / 15%));
        pointer-events: none;
        z-index: 2;
      }
      .workspace:hover::after {
        border-color: var(
          --item-container-border-hover-color,
          rgba(255 255 255 / 40%)
        );
      }
      .workspace:focus-visible {
        outline-offset: -1px;
      }
    </style>
  </template>;

export default WorkspaceChooserItemContainer;
