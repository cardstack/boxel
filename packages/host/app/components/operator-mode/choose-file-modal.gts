import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelButton,
  FieldContainer,
  BoxelSelect,
} from '@cardstack/boxel-ui/components';

import {
  Deferred,
  RealmPaths,
  type LocalPath,
} from '@cardstack/runtime-common';

import ModalContainer from '@cardstack/host/components/modal-container';

import MatrixService from '@cardstack/host/services/matrix-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import FileTree from '../editor/file-tree';

interface Signature {
  Args: {};
}

export default class ChooseFileModal extends Component<Signature> {
  @tracked deferred?: Deferred<FileDef>;
  @tracked selectedRealm = this.knownRealms[0];
  @tracked selectedFile?: LocalPath;

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare matrixService: MatrixService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_FILE_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_FILE_CHOOSER;
    });
  }

  // public API
  async chooseFile<T extends FileDef>(): Promise<undefined | T> {
    this.deferred = new Deferred();
    let defaultRealm = this.knownRealms.find(
      (r) =>
        r.url.toString() === this.operatorModeStateService.realmURL?.toString(),
    );
    this.selectedRealm = defaultRealm ?? this.selectedRealm;

    let file = await this.deferred.promise;
    if (file) {
      return file as T;
    } else {
      return undefined;
    }
  }

  @action
  private pick(path: LocalPath | undefined) {
    if (this.deferred && this.selectedRealm && path) {
      let fileURL = new RealmPaths(this.selectedRealm.url).fileURL(path);
      let file = this.matrixService.fileAPI.createFileDef({
        sourceUrl: fileURL.toString(),
        name: fileURL.toString().split('/').pop()!,
      });
      this.deferred.fulfill(file);
    }

    this.selectedRealm = this.knownRealms[0];
    this.selectedFile = undefined;
    this.deferred = undefined;
  }

  private get knownRealms() {
    return Object.entries(this.realm.allRealmsInfo).map((entry) => ({
      url: new URL(entry[0]),
      info: entry[1].info,
    }));
  }

  @action
  private selectRealm(realm: any) {
    this.selectedRealm = realm;
  }

  @action
  private async selectFile(file: LocalPath) {
    this.selectedFile = file;
  }

  @action private handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.pick(undefined);
    }
  }

  <template>
    <style scoped>
      :deep(.dialog-box__content) {
        overflow: hidden;
      }
      .choose-file-modal {
        --horizontal-gap: var(--boxel-sp-xs);
      }
      .choose-file-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.choose-file-modal__container) {
        height: 32rem;
      }
      .field + .field {
        margin-top: var(--boxel-sp-sm);
      }
      .field {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs) var(--horizontal-gap);
      }
      .field :deep(.label-container) {
        width: 8rem;
      }
      .field :deep(.content) {
        flex-grow: 1;
        max-width: 100%;
        min-width: 13rem;
      }
      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
        align-self: center;
      }
      fieldset.field {
        border: none;
        padding: 0;
        margin-inline: 0;
      }
      .realm-chooser {
        width: 100%;
      }
      .realm-chooser__options {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .realm-chooser__options img {
        width: 16px;
        height: 16px;
      }
      .realm-chooser__options span {
        font: 500 var(--boxel-font-sm);
      }
      .choose-file {
        overflow: hidden;
      }
      .choose-file :deep(.content) {
        height: 267px;
        overflow: auto;
        align-items: flex-start;
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xxs);
      }
      :deep(.dialog-box__footer) {
        height: auto;
        border: none;
        padding: 0 var(--boxel-sp) 40px var(--boxel-sp);
      }
    </style>
    {{#if this.deferred}}
      <ModalContainer
        @title='Choose a File'
        @onClose={{fn this.pick undefined}}
        @size='medium'
        @centered={{true}}
        {{on 'keydown' this.handleKeydown}}
        @cardContainerClass='choose-file-modal__container'
        class='choose-file-modal'
        data-test-choose-file-modal
      >
        <:content>
          <FieldContainer class='field' @label='Workspace'>
            <BoxelSelect
              class='realm-chooser'
              @options={{this.knownRealms}}
              @selected={{this.selectedRealm}}
              @onChange={{this.selectRealm}}
              data-test-choose-file-modal-realm-chooser
              as |item|
            >
              <div
                class='realm-chooser__options'
                data-test-choose-file-modal-realm-option={{item.info.name}}
              >
                <img src={{item.info.iconURL}} alt='realm icon' />
                <span>{{item.info.name}}</span>
              </div>
            </BoxelSelect>
          </FieldContainer>
          <FieldContainer
            class='field choose-file'
            @label='Choose File'
            @tag='div'
          >
            <FileTree
              @realmURL={{this.selectedRealm.url}}
              @onFileSelected={{this.selectFile}}
            />
          </FieldContainer>
        </:content>
        <:footer>
          <div class='footer-buttons'>
            <BoxelButton
              @size='tall'
              {{on 'click' (fn this.pick undefined)}}
              {{onKeyMod 'Escape'}}
              data-test-choose-file-modal-cancel-button
            >
              Cancel
            </BoxelButton>
            <BoxelButton
              @kind='primary'
              @size='tall'
              {{on 'click' (fn this.pick this.selectedFile)}}
              {{onKeyMod 'Enter'}}
              data-test-choose-file-modal-add-button
            >
              Add
            </BoxelButton>
          </div>
        </:footer>
      </ModalContainer>
    {{/if}}
  </template>
}
