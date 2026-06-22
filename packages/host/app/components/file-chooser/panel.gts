import { hash } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { CodeRef, LocalPath } from '@cardstack/runtime-common';

import type FileUploadService from '@cardstack/host/services/file-upload';
import type { FileUploadTask } from '@cardstack/host/services/file-upload';
import type RealmService from '@cardstack/host/services/realm';
import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import IndexedFileTree from '../editor/indexed-file-tree';
import RealmDropdown, { type RealmDropdownItem } from '../realm-dropdown';

import type { WithBoundArgs } from '@glint/template';

export type FileChooserRealm = { url: URL; info: EnhancedRealmInfo };

interface Signature {
  Args: {
    initialRealmURL?: string;
    selectedFile?: LocalPath;
    fileTypeFilter?: CodeRef;
    fileFieldFilter?: Record<string, unknown>;
    acceptTypes?: string;
    onRealmChange?: (realm: FileChooserRealm) => void;
    onFileSelected?: (path: LocalPath) => void;
    onFileConfirmed?: (path: LocalPath) => void;
    onUploadComplete: (file: FileDef) => void;
  };
  Blocks: {
    default: [
      {
        RealmDropdown: WithBoundArgs<
          typeof RealmDropdown,
          'selectedRealmURL' | 'onSelect' | 'displayReadOnlyTag'
        >;
        FileTree: WithBoundArgs<
          typeof IndexedFileTree,
          | 'selectedFile'
          | 'fileTypeFilter'
          | 'fileFieldFilter'
          | 'onFileSelected'
          | 'onFileConfirmed'
        >;
        fileTreeKey: string;
        selectedRealm: FileChooserRealm | undefined;
        selectedRealmURL: string | undefined;
        currentUpload: FileUploadTask | undefined;
        isUploadBusy: boolean;
        triggerUpload: () => void;
        dropZoneActive: boolean;
        dropZoneLabel: string;
        onDragEnter: (event: Event) => void;
        onDragOver: (event: Event) => void;
        onDragLeave: (event: Event) => void;
        onDrop: (event: Event) => void;
      },
    ];
  };
}

export default class FileChooser extends Component<Signature> {
  @service declare private realm: RealmService;
  @service('file-upload') declare private fileUpload: FileUploadService;

  @tracked private selectedRealm: FileChooserRealm | undefined =
    this.initialRealm;
  @tracked private currentUpload?: FileUploadTask;
  @tracked private isDropZoneActive = false;
  // Bumped on realm switch so the yielded FileTree (which keys off realm URL
  // internally) is fully recreated rather than reused across workspaces.
  @tracked private fileTreeRenderNonce = 0;
  private dropZoneDragDepth = 0;

  private get knownRealms(): FileChooserRealm[] {
    return Object.entries(this.realm.allRealmsInfo).map((entry) => ({
      url: new URL(entry[0]),
      info: entry[1].info,
    }));
  }

  private get initialRealm(): FileChooserRealm | undefined {
    let realms = this.knownRealms;
    let match = this.args.initialRealmURL
      ? realms.find((r) => r.url.href === this.args.initialRealmURL)
      : undefined;
    return match ?? realms[0];
  }

  private get selectedRealmURL(): string | undefined {
    return this.selectedRealm?.url.href;
  }

  private get fileTreeKey(): string {
    return `${this.fileTreeRenderNonce}:${this.selectedRealm?.url.href ?? ''}`;
  }

  private get isUploadBusy(): boolean {
    let state = this.currentUpload?.state;
    return state === 'picking' || state === 'uploading';
  }

  private get dropZoneLabel(): string {
    if (!this.selectedRealm) {
      return '';
    }
    return `Drop file to upload to ${this.selectedRealm.info.name}`;
  }

  @action
  private selectRealm({ path }: RealmDropdownItem) {
    let realm = this.knownRealms.find((r) => r.url.href === path);
    if (!realm) {
      return;
    }
    this.selectedRealm = realm;
    this.fileTreeRenderNonce++;
    this.args.onRealmChange?.(realm);
  }

  @action
  private handleFileSelected(path: LocalPath) {
    this.args.onFileSelected?.(path);
  }

  @action
  private handleFileConfirmed(path: LocalPath) {
    this.args.onFileConfirmed?.(path);
  }

  @action
  private triggerUpload() {
    if (!this.selectedRealm) {
      return;
    }
    let task = this.fileUpload.uploadFile({
      realmURL: this.selectedRealm.url,
      acceptTypes: this.args.acceptTypes,
    });
    this.beginUpload(task);
  }

  @action
  private handleDragEnter(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth++;
    this.isDropZoneActive = true;
  }

  @action
  private handleDragOver(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.isDropZoneActive = true;
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.dropEffect = 'copy';
    }
  }

  @action
  private handleDragLeave(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer) && !this.isDropZoneActive) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth = Math.max(0, this.dropZoneDragDepth - 1);
    if (this.dropZoneDragDepth === 0) {
      this.isDropZoneActive = false;
    }
  }

  @action
  private handleDrop(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth = 0;
    this.isDropZoneActive = false;
    if (this.isUploadBusy || !this.selectedRealm) {
      return;
    }
    let file = dragEvent.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    let task = this.fileUpload.uploadProvidedFile({
      realmURL: this.selectedRealm.url,
      file,
    });
    this.beginUpload(task);
  }

  private beginUpload(task: FileUploadTask) {
    this.currentUpload = task;
    task.result.then((fileDef) => {
      if (fileDef) {
        this.currentUpload = undefined;
        this.args.onUploadComplete(fileDef);
      } else if (task.state !== 'error') {
        this.currentUpload = undefined;
      }
    });
  }

  private isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
    if (!dataTransfer) {
      return false;
    }
    return Array.from(dataTransfer.types ?? []).includes('Files');
  }

  <template>
    {{yield
      (hash
        RealmDropdown=(component
          RealmDropdown
          selectedRealmURL=this.selectedRealmURL
          onSelect=this.selectRealm
          displayReadOnlyTag=true
        )
        FileTree=(component
          IndexedFileTree
          selectedFile=@selectedFile
          fileTypeFilter=@fileTypeFilter
          fileFieldFilter=@fileFieldFilter
          onFileSelected=this.handleFileSelected
          onFileConfirmed=this.handleFileConfirmed
        )
        fileTreeKey=this.fileTreeKey
        selectedRealm=this.selectedRealm
        selectedRealmURL=this.selectedRealmURL
        currentUpload=this.currentUpload
        isUploadBusy=this.isUploadBusy
        triggerUpload=this.triggerUpload
        dropZoneActive=this.isDropZoneActive
        dropZoneLabel=this.dropZoneLabel
        onDragEnter=this.handleDragEnter
        onDragOver=this.handleDragOver
        onDragLeave=this.handleDragLeave
        onDrop=this.handleDrop
      )
    }}
  </template>
}
