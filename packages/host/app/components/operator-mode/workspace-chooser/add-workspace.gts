import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { IconPlus } from '@cardstack/boxel-ui/icons';

import { CreateWorkspaceFlow } from '@cardstack/host/lib/create-workspace-flow';
import focusWhenSelected from '@cardstack/host/modifiers/focus-when-selected';

import AddWorkspaceModal from '../dashboard-modals/add-workspace-modal';

import ItemContainer from './item-container';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    isSelected?: boolean;
    // The ring shows only once the user moves the keyboard selection.
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
      {{on 'click' (fn this.flow.setIsModalOpen true)}}
      {{focusWhenSelected @isSelected}}
      class='container {{if this.showSelectionRing "is-selected"}}'
      title='Create a New Workspace'
      data-nav-index={{@navIndex}}
      data-test-add-workspace
      data-test-add-workspace-selected={{if @isSelected 'selected'}}
    >
      <div class='content'>
        <IconPlus width='32px' height='32px' role='presentation' class='icon' />
        <br />
        New Workspace
      </div>
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
        }}
      />
    {{/if}}
    <style scoped>
      .container {
        border-style: none;
        background: transparent;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .icon {
        --icon-color: var(--boxel-highlight);
      }
      .icon :deep(path) {
        stroke: none;
      }
      .content {
        color: var(--boxel-light);
        text-align: center;
      }
      .content .icon {
        color: var(--boxel-highlight);
      }
    </style>
  </template>
}
