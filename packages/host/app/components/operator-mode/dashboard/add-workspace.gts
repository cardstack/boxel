import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import Plus from '@cardstack/boxel-icons/plus';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { cn } from '@cardstack/boxel-ui/helpers';

import { CreateWorkspaceFlow } from '@cardstack/host/lib/create-workspace-flow';
import focusWhenSelected from '@cardstack/host/modifiers/focus-when-selected';

import { AddWorkspaceModal } from '../workspace-chooser/add-workspace';

import ItemContainer from './item-container';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    isSelected?: boolean;
    // Whether the keyboard cursor is showing; the ring waits for it.
    selectionActive?: boolean;
    navIndex?: number;
  };
}

export default class AddWorkspace extends Component<Signature> {
  private flow = new CreateWorkspaceFlow(this);

  private get showSelectionRing() {
    return Boolean(this.args.isSelected && this.args.selectionActive);
  }

  <template>
    <ItemContainer
      class={{cn 'add-workspace' is-selected=this.showSelectionRing}}
      title='Create a New Workspace'
      data-nav-index={{@navIndex}}
      {{on 'click' (fn this.flow.setIsModalOpen true)}}
      {{focusWhenSelected @isSelected scrollOnOpen='when-off-screen'}}
      data-test-add-workspace
      data-test-add-workspace-selected={{if @isSelected 'selected'}}
      data-test-workspace-ring={{if this.showSelectionRing 'New Workspace'}}
      ...attributes
    >
      <span class='content'>
        <Plus class='icon' width='20' height='20' aria-hidden='true' />
        New Workspace
      </span>
    </ItemContainer>
    {{#if this.flow.isModalOpen}}
      <ToElsewhere
        @named='modal-elsewhere'
        @send={{component
          AddWorkspaceModal
          displayName=this.flow.displayName
          endpoint=this.flow.endpoint
          setDisplayName=this.flow.setDisplayName
          setEndpoint=this.flow.setEndpoint
          createWorkspaceTask=this.flow.createWorkspaceTask
          error=this.flow.error
          onClose=(fn this.flow.setIsModalOpen false)
        }}
      />
    {{/if}}
    <style scoped>
      .add-workspace {
        justify-content: center;
        align-items: center;
        background-color: transparent;
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
        color: var(--boxel-light);
        transition: box-shadow var(--boxel-transition);
      }
      .add-workspace:hover {
        box-shadow: inset 0 0 0 1px var(--boxel-light-25);
      }
      .add-workspace.is-selected,
      .add-workspace:focus-visible {
        box-shadow: var(--dashboard-ring);
      }
      .content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font: 600 var(--boxel-font-sm);
      }
      .icon {
        flex-shrink: 0;
        color: var(--boxel-highlight);
      }
    </style>
  </template>
}
