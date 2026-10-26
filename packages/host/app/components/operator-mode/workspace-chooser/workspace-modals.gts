import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import CopyIcon from '@cardstack/boxel-icons/copy';
import { Button } from '@cardstack/pretui/components/button';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import pluralize from 'pluralize';

import { RealmIcon } from '@cardstack/boxel-ui/components';
import { Warning as WarningIcon } from '@cardstack/boxel-ui/icons';

import type { RealmIdentifier } from '@cardstack/runtime-common';

import ModalContainer from '@cardstack/host/components/modal-container';
import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';

// The tile's Delete, Archive and Duplicate modals. The tile sends them to the
// operator-mode modal outlet, so they render outside the dashboard's size
// container, which would otherwise trap their fixed positioning.

interface ModalFocusArgs {
  onClose: () => void;
  returnFocusTarget: () => HTMLElement | undefined;
}

// Focus opens on Cancel, stays in the modal, and goes back to the tile on
// close. Escape closes the modal. The confirm button turns busy
// rather than being replaced while its task runs, so it keeps focus.
function modalFocusTrapOptions(dialogId: string, args: ModalFocusArgs) {
  return {
    initialFocus: `#${dialogId} [data-modal-initial-focus]`,
    fallbackFocus: `#${dialogId}`,
    allowOutsideClick: true,
    escapeDeactivates: () => {
      args.onClose();
      return false;
    },
    setReturnFocus: (previous: HTMLElement | SVGElement) =>
      args.returnFocusTarget() ?? previous,
  };
}

interface DeleteWorkspaceModalSignature {
  Args: {
    realmIdentifier: RealmIdentifier;
    realmInfo: EnhancedRealmInfo;
    name: string;
    realmURLText: string;
    isLoadingSummary: boolean;
    summaryText: string | null;
    publishedRealmURLs: string[];
    error: string | undefined;
    isDeleting: boolean;
    onConfirm: () => void;
    onClose: () => void;
    returnFocusTarget: () => HTMLElement | undefined;
  };
}

export class DeleteWorkspaceModal extends Component<DeleteWorkspaceModalSignature> {
  private dialogId = guidFor(this);

  private get focusTrapOptions() {
    return modalFocusTrapOptions(this.dialogId, this.args);
  }

  <template>
    <ModalContainer
      @title='Delete Workspace'
      @onClose={{@onClose}}
      @size='medium'
      @isCloseDisabled={{@isDeleting}}
      @cardContainerClass='workspace-chooser-delete-modal'
      class='workspace-chooser-delete-modal-container'
      aria-label='Delete Workspace'
      id={{this.dialogId}}
      tabindex='-1'
      {{focusTrap focusTrapOptions=this.focusTrapOptions}}
      data-test-delete-modal={{@realmIdentifier}}
    >
      <:content>
        <div class='delete-modal__workspace-card'>
          <RealmIcon
            class='delete-modal__realm-icon'
            @realmInfo={{@realmInfo}}
          />
          <div class='delete-modal__workspace-info'>
            <span class='delete-modal__workspace-name'>{{@name}}</span>
            <span
              class='delete-modal__workspace-url'
              data-test-delete-modal-workspace-url
            >{{@realmURLText}}</span>
            {{#if @isLoadingSummary}}
              <span class='delete-modal__workspace-meta'>
                Checking what will be removed from this workspace…
              </span>
            {{else if @summaryText}}
              <span class='delete-modal__workspace-meta'>
                Contains
                <strong>{{@summaryText}}</strong>
              </span>
            {{/if}}
          </div>
        </div>

        <div class='delete-modal__warning warning'>
          <WarningIcon
            class='delete-modal__warning-icon'
            width='20'
            height='20'
            aria-hidden='true'
          />
          <div class='delete-modal__warning-body'>
            <div>
              This permanently deletes the workspace and any custom domains tied
              to it. Links to cards in this workspace may stop working
              elsewhere.
            </div>
            {{#if @publishedRealmURLs.length}}
              <div class='delete-modal__realms'>
                <p class='delete-modal__realms-title'>
                  Published
                  {{pluralize 'realm' @publishedRealmURLs.length}}
                  that will also be removed
                </p>
                <ul class='delete-modal__realms-list'>
                  {{#each @publishedRealmURLs as |publishedRealmURL|}}
                    <li>{{publishedRealmURL}}</li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}
            <p class='delete-modal__irreversible'>
              This action is not reversible.
            </p>
          </div>
        </div>

        {{#if @error}}
          <div
            class='delete-modal__warning error'
            role='alert'
            data-test-delete-error
          >
            {{@error}}
          </div>
        {{/if}}
      </:content>
      <:footer>
        <div class='delete-modal__footer'>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @disabled={{@isDeleting}}
            {{on 'click' @onClose}}
            data-modal-initial-focus
            data-test-cancel-delete-button
          >
            Cancel
          </Button>
          <Button
            @tone='danger'
            @appearance='accent'
            @busy={{@isDeleting}}
            @busyLabel='Deleting…'
            {{on 'click' @onConfirm}}
            data-test-confirm-delete-button
          >
            Delete this workspace
          </Button>
        </div>
      </:footer>
    </ModalContainer>
    <style scoped>
      .workspace-chooser-delete-modal-container {
        --stack-card-footer-height: auto;
      }
      .workspace-chooser-delete-modal-container > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.workspace-chooser-delete-modal) {
        height: auto;
        display: flex;
        flex-direction: column;
      }
      :deep(.workspace-chooser-delete-modal > .dialog-box__content) {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      :deep(.workspace-chooser-delete-modal > .dialog-box__content > * + *) {
        margin-top: 0;
      }
      .delete-modal__warning-icon {
        flex-shrink: 0;
      }
      .delete-modal__workspace-card {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-sm);
      }
      .delete-modal__realm-icon {
        flex-shrink: 0;
        --boxel-realm-icon-size: 1.875rem;
      }
      .delete-modal__workspace-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .delete-modal__workspace-name {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
        color: var(--boxel-dark);
      }
      .delete-modal__workspace-name,
      .delete-modal__workspace-url {
        overflow-wrap: break-word;
      }
      .delete-modal__workspace-url,
      .delete-modal__workspace-meta {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--boxel-450);
      }
      .delete-modal__warning {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-lg);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .delete-modal__warning.warning {
        flex-direction: row;
        align-items: flex-start;
        gap: var(--boxel-sp-sm);
        background-color: var(--boxel-warning-200);
        color: var(--boxel-dark);
      }
      .delete-modal__warning.error {
        border: 1px solid var(--boxel-error-200);
        background-color: rgb(from var(--boxel-error-200) r g b / 8%);
        color: var(--boxel-error-200);
      }
      .delete-modal__warning-body {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .delete-modal__irreversible {
        margin: 0;
        font-weight: 600;
      }
      .delete-modal__realms {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-4xs);
      }
      .delete-modal__realms-title {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
        color: var(--boxel-dark);
      }
      .delete-modal__realms-list {
        margin: 0;
        padding-left: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .delete-modal__realms-list li {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--boxel-dark);
        list-style: disc;
      }
      .delete-modal__footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-sm);
        width: 100%;
      }
    </style>
  </template>
}

interface ArchiveWorkspaceModalSignature {
  Args: {
    realmIdentifier: RealmIdentifier;
    realmInfo: EnhancedRealmInfo;
    name: string;
    realmURLText: string;
    error: string | undefined;
    isArchiving: boolean;
    onConfirm: () => void;
    onClose: () => void;
    returnFocusTarget: () => HTMLElement | undefined;
  };
}

export class ArchiveWorkspaceModal extends Component<ArchiveWorkspaceModalSignature> {
  private dialogId = guidFor(this);

  private get focusTrapOptions() {
    return modalFocusTrapOptions(this.dialogId, this.args);
  }

  <template>
    <ModalContainer
      @title=''
      @onClose={{@onClose}}
      @size='medium'
      @cardContainerClass='workspace-chooser-archive-modal'
      class='workspace-chooser-archive-modal-container'
      aria-labelledby='{{this.dialogId}}-title'
      id={{this.dialogId}}
      tabindex='-1'
      {{focusTrap focusTrapOptions=this.focusTrapOptions}}
      data-test-archive-modal={{@realmIdentifier}}
    >
      <:content>
        <div class='archive-modal__header'>
          <ArchiveIcon
            class='archive-modal__icon'
            width='40'
            height='40'
            aria-hidden='true'
          />
          <h2 id='{{this.dialogId}}-title' class='archive-modal__title'>Archive
            Workspace</h2>
        </div>

        <div class='archive-modal__workspace-card'>
          <div class='archive-modal__realm-icon-wrapper'>
            <RealmIcon
              class='archive-modal__realm-icon'
              @realmInfo={{@realmInfo}}
            />
          </div>
          <div class='archive-modal__workspace-info'>
            <span class='archive-modal__workspace-name'>{{@name}}</span>
            <span
              class='archive-modal__workspace-url'
              data-test-archive-modal-workspace-url
            >{{@realmURLText}}</span>
          </div>
        </div>

        <div class='archive-modal__info-box'>
          <p class='archive-modal__info-text'>
            Archiving hides this workspace from your realm list and stops its
            indexer. While archived, it
            <strong>
              will not be available for viewing or editing — to you or any other
              user
            </strong>
            — until you restore it.
          </p>
          <p class='archive-modal__info-text'>
            You can restore it at any time from the Archived list.
          </p>
        </div>

        {{#if @error}}
          <p class='archive-modal__error' role='alert'>{{@error}}</p>
        {{/if}}
      </:content>
      <:footer>
        <div class='archive-modal__footer'>
          <div class='archive-modal__actions'>
            <Button
              @tone='neutral'
              @appearance='outlined'
              @disabled={{@isArchiving}}
              {{on 'click' @onClose}}
              data-modal-initial-focus
              data-test-cancel-archive-button
            >
              Cancel
            </Button>
            <Button
              @tone='neutral'
              @busy={{@isArchiving}}
              @busyLabel='Archiving…'
              {{on 'click' @onConfirm}}
              data-test-confirm-archive-button
            >
              Archive this workspace
            </Button>
          </div>
          <span class='archive-modal__disclaimer'>
            You can restore this workspace later
          </span>
        </div>
      </:footer>
    </ModalContainer>
    <style scoped>
      .workspace-chooser-archive-modal-container > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.workspace-chooser-archive-modal) {
        border-radius: var(--boxel-border-radius-2xl);
        max-width: var(--boxel-md-container);
        height: auto;
        display: flex;
        flex-direction: column;
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__header) {
        display: none;
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__content) {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        overflow: visible;
        height: auto;
        flex: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__content > * + *) {
        margin-top: 0;
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__footer) {
        height: auto;
        flex: none;
        padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
        border-top: none;
      }
      .archive-modal__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .archive-modal__icon {
        color: var(--boxel-dark);
        flex-shrink: 0;
      }
      .archive-modal__title {
        font-size: 1.625rem;
        font-weight: 700;
        color: var(--boxel-dark);
        margin: 0;
      }
      .archive-modal__workspace-card {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp);
        min-height: 5.125rem;
      }
      .archive-modal__realm-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        border-radius: calc(
          var(--boxel-border-radius-xs) + var(--boxel-border-radius-sm)
        );
        display: flex;
      }
      .archive-modal__realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px var(--boxel-light-50);
        z-index: 1;
        pointer-events: none;
      }
      .archive-modal__realm-icon {
        --boxel-realm-icon-size: 2.625rem;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 0.375rem
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .archive-modal__workspace-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .archive-modal__workspace-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
        overflow-wrap: break-word;
      }
      .archive-modal__workspace-url {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--boxel-450);
        overflow-wrap: break-word;
      }
      .archive-modal__info-box {
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .archive-modal__info-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        color: var(--boxel-dark);
      }
      .archive-modal__error {
        color: var(--boxel-danger);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        margin: 0;
      }
      .archive-modal__footer {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .archive-modal__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .archive-modal__disclaimer {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--boxel-500);
      }
    </style>
  </template>
}

interface DuplicateWorkspaceModalSignature {
  Args: {
    realmIdentifier: RealmIdentifier;
    realmInfo: EnhancedRealmInfo;
    name: string;
    error: string | undefined;
    isDuplicating: boolean;
    progressLabel: string;
    onConfirm: () => void;
    onClose: () => void;
    returnFocusTarget: () => HTMLElement | undefined;
  };
}

export class DuplicateWorkspaceModal extends Component<DuplicateWorkspaceModalSignature> {
  private dialogId = guidFor(this);

  private get focusTrapOptions() {
    return modalFocusTrapOptions(this.dialogId, this.args);
  }

  <template>
    <ModalContainer
      @title=''
      @onClose={{@onClose}}
      @size='medium'
      @cardContainerClass='workspace-chooser-duplicate-modal'
      class='workspace-chooser-duplicate-modal-container'
      aria-labelledby='{{this.dialogId}}-title'
      id={{this.dialogId}}
      tabindex='-1'
      {{focusTrap focusTrapOptions=this.focusTrapOptions}}
      data-test-duplicate-modal={{@realmIdentifier}}
    >
      <:content>
        <div class='duplicate-modal__header'>
          <CopyIcon
            class='duplicate-modal__icon'
            width='40'
            height='40'
            aria-hidden='true'
          />
          <h2
            id='{{this.dialogId}}-title'
            class='duplicate-modal__title'
          >Duplicate Workspace</h2>
        </div>

        <div class='duplicate-modal__workspace-card'>
          <div class='duplicate-modal__realm-icon-wrapper'>
            <RealmIcon
              class='duplicate-modal__realm-icon'
              @realmInfo={{@realmInfo}}
            />
          </div>
          <div class='duplicate-modal__workspace-info'>
            <span class='duplicate-modal__workspace-name'>{{@name}}</span>
          </div>
        </div>

        <div class='duplicate-modal__info-box'>
          <p class='duplicate-modal__info-text'>
            This copies every card and file in this workspace into a new
            <strong>private workspace</strong>
            that only you can see and edit. The original stays untouched.
          </p>
        </div>

        {{#if @error}}
          <p
            class='duplicate-modal__error'
            role='alert'
            data-test-duplicate-error
          >{{@error}}</p>
        {{/if}}
      </:content>
      <:footer>
        <div class='duplicate-modal__footer'>
          <div class='duplicate-modal__actions'>
            {{#if @isDuplicating}}
              <span
                class='duplicate-modal__progress'
                data-test-duplicate-progress
              >{{@progressLabel}}</span>
            {{/if}}
            {{! Closing while copying cancels the copy. }}
            <Button
              @tone='neutral'
              @appearance='outlined'
              {{on 'click' @onClose}}
              data-modal-initial-focus
              data-test-cancel-duplicate-button
            >
              Cancel
            </Button>
            <Button
              @tone='primary'
              @appearance='accent'
              @busy={{@isDuplicating}}
              @busyLabel='Copying…'
              {{on 'click' @onConfirm}}
              data-test-confirm-duplicate-button
            >
              Duplicate this workspace
            </Button>
          </div>
        </div>
      </:footer>
    </ModalContainer>
    <style scoped>
      .workspace-chooser-duplicate-modal-container
        > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.workspace-chooser-duplicate-modal) {
        border-radius: var(--boxel-border-radius-2xl);
        max-width: var(--boxel-md-container);
        height: auto;
        display: flex;
        flex-direction: column;
      }
      :deep(.workspace-chooser-duplicate-modal > .dialog-box__header) {
        display: none;
      }
      :deep(.workspace-chooser-duplicate-modal > .dialog-box__content) {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        overflow: visible;
        height: auto;
        flex: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      :deep(.workspace-chooser-duplicate-modal > .dialog-box__content > * + *) {
        margin-top: 0;
      }
      :deep(.workspace-chooser-duplicate-modal > .dialog-box__footer) {
        height: auto;
        flex: none;
        padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
        border-top: none;
      }
      .duplicate-modal__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .duplicate-modal__icon {
        color: var(--boxel-dark);
        flex-shrink: 0;
      }
      .duplicate-modal__title {
        font-size: 1.625rem;
        font-weight: 700;
        color: var(--boxel-dark);
        margin: 0;
      }
      .duplicate-modal__workspace-card {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp);
        min-height: 5.125rem;
      }
      .duplicate-modal__realm-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        border-radius: calc(
          var(--boxel-border-radius-xs) + var(--boxel-border-radius-sm)
        );
        display: flex;
      }
      .duplicate-modal__realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px var(--boxel-light-50);
        z-index: 1;
        pointer-events: none;
      }
      .duplicate-modal__realm-icon {
        --boxel-realm-icon-size: 2.625rem;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 0.375rem
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .duplicate-modal__workspace-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .duplicate-modal__workspace-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
        overflow-wrap: break-word;
      }
      .duplicate-modal__info-box {
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .duplicate-modal__info-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        color: var(--boxel-dark);
      }
      .duplicate-modal__error {
        color: var(--boxel-danger);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        margin: 0;
      }
      .duplicate-modal__footer {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .duplicate-modal__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .duplicate-modal__progress {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--boxel-dark);
      }
    </style>
  </template>
}
