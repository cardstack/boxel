import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Plus from '@cardstack/boxel-icons/plus';
import { task } from 'ember-concurrency';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { cn } from '@cardstack/boxel-ui/helpers';

import { generateRandomWorkspaceName } from '@cardstack/host/lib/random-name';
import {
  getRandomBackgroundURL,
  iconURLFor,
  toWorkspaceEndpoint,
} from '@cardstack/host/lib/utils';
import focusWhenSelected from '@cardstack/host/modifiers/focus-when-selected';
import type MatrixService from '@cardstack/host/services/matrix-service';

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
  @service declare private matrixService: MatrixService;
  @tracked private isModalOpen = false;
  @tracked private endpoint = '';
  @tracked private displayName = '';
  @tracked private hasUserEditedEndpoint = false;
  @tracked private error: string | null = null;

  private setEndpoint = (value: string) => {
    this.hasUserEditedEndpoint = true;
    this.endpoint = value;
  };

  // The endpoint follows the name until the user edits it.
  private setDisplayName = (value: string) => {
    this.displayName = value;
    if (!this.hasUserEditedEndpoint) {
      this.endpoint = toWorkspaceEndpoint(value);
    }
  };

  private createWorkspaceTask = task(async () => {
    this.error = null;
    try {
      await this.matrixService.createPersonalRealmForUser({
        endpoint: this.endpoint,
        name: this.displayName,
        iconURL: iconURLFor(this.displayName),
        backgroundURL: getRandomBackgroundURL(),
      });
      this.isModalOpen = false;
    } catch (e: any) {
      this.error = e.message;
    }
  });

  private get showSelectionRing() {
    return Boolean(this.args.isSelected && this.args.selectionActive);
  }

  private setIsModalOpen = (value: boolean) => {
    this.isModalOpen = value;
    if (value) {
      this.error = null;
      this.hasUserEditedEndpoint = false;
      this.setDisplayName(generateRandomWorkspaceName());
    }
  };

  <template>
    <ItemContainer
      class={{cn 'add-workspace' is-selected=this.showSelectionRing}}
      data-nav-index={{@navIndex}}
      {{on 'click' (fn this.setIsModalOpen true)}}
      {{focusWhenSelected @isSelected scrollOnOpen='never'}}
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
    {{#if this.isModalOpen}}
      <ToElsewhere
        @named='modal-elsewhere'
        @send={{component
          AddWorkspaceModal
          displayName=this.displayName
          endpoint=this.endpoint
          setDisplayName=this.setDisplayName
          setEndpoint=this.setEndpoint
          createWorkspaceTask=this.createWorkspaceTask
          error=this.error
          onClose=(fn this.setIsModalOpen false)
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
