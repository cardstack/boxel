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
        min-width: var(--workspace-chooser-tile-width);
        width: var(--workspace-chooser-tile-width);
        height: var(--workspace-chooser-tile-height);
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
      /* The tile carries the keyboard cursor; its selection ring shows it,
         so focus draws no outline of its own. */
      .workspace:focus-visible {
        outline: none;
      }
      .workspace.is-selected::after {
        border-color: var(--boxel-teal);
        box-shadow: 0 0 0 1px var(--boxel-teal);
      }
    </style>
  </template>;

export default WorkspaceChooserItemContainer;
