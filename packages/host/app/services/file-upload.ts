import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import {
  Deferred,
  RealmPaths,
  isCardErrorJSONAPI,
  toSafeFileName,
  type LocalPath,
  type RealmIdentifier,
} from '@cardstack/runtime-common';
import {
  fileSizeLimitFor,
  validateByteLength,
} from '@cardstack/runtime-common/write-size-validation';

import type EnvironmentService from './environment-service';
import type NetworkService from './network';
import type SessionService from './session';
import type StoreService from './store';
import type { FileDef } from '@cardstack/base/file-api';

export class FileUploadTask {
  @tracked state: 'picking' | 'uploading' | 'complete' | 'error' = 'picking';
  @tracked error?: string;
  @tracked fileName?: string;
  result: Promise<FileDef | undefined>;

  private _fileDeferred = new Deferred<File | null>();
  private _resultDeferred = new Deferred<FileDef | undefined>();

  constructor() {
    this.result = this._resultDeferred.promise;
  }

  // Test seam: provide a file without the native picker
  __provideFileForTesting(file: File | null) {
    this._fileDeferred.fulfill(file);
  }

  _resolveFile(file: File | null) {
    this._fileDeferred.fulfill(file);
  }

  awaitFile(): Promise<File | null> {
    return this._fileDeferred.promise;
  }

  _fulfill(value: FileDef | undefined) {
    this._resultDeferred.fulfill(value);
  }
}

export default class FileUploadService extends Service {
  @service declare private environmentService: EnvironmentService;
  @service declare private network: NetworkService;
  @service declare private session: SessionService;
  @service declare private store: StoreService;

  @tracked activeUploads: FileUploadTask[] = [];
  private queuedLocalFilesForTesting: (File | null)[] = [];
  private queuedLocalFileBatchesForTesting: File[][] = [];

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.activeUploads = [];
  }

  uploadFile(opts: {
    realm: RealmIdentifier;
    acceptTypes?: string;
  }): FileUploadTask {
    let task = new FileUploadTask();
    this._startTask(task, opts.realm);

    if (!isTesting()) {
      this._openFilePicker(task, opts.acceptTypes);
    }

    return task;
  }

  uploadProvidedFile(opts: {
    realm: RealmIdentifier;
    file: File;
  }): FileUploadTask {
    let task = new FileUploadTask();
    this._startTask(task, opts.realm);
    task._resolveFile(opts.file);

    return task;
  }

  private _startTask(task: FileUploadTask, realm: RealmIdentifier) {
    this.activeUploads = [...this.activeUploads, task];
    this._processUpload(task, realm).finally(() => {
      this.activeUploads = this.activeUploads.filter((t) => t !== task);
    });
  }

  async pickLocalFile(opts?: {
    acceptTypes?: string;
  }): Promise<File | undefined> {
    if (isTesting()) {
      let next = this.queuedLocalFilesForTesting.shift();
      return next ?? undefined;
    }
    let file = await this._openNativeFilePicker(opts?.acceptTypes);
    return file ?? undefined;
  }

  async pickLocalFiles(opts?: { acceptTypes?: string }): Promise<File[]> {
    if (isTesting()) {
      return this.queuedLocalFileBatchesForTesting.shift() ?? [];
    }
    return this._openNativeFilePickerMulti(opts?.acceptTypes);
  }

  // Opens the multi-file picker and uploads every chosen file to the realm.
  // Parallel POSTs are safe: the realm advisory lock serializes writes
  // server-side (packages/runtime-common/realm.ts). Each entry resolves to
  // the uploaded FileDef, or undefined for a file whose upload failed — the
  // per-file failure detail stays on the task in `activeUploads`.
  async pickAndUploadFiles(
    realm: RealmIdentifier,
  ): Promise<(FileDef | undefined)[]> {
    let files = await this.pickLocalFiles({});
    let tasks = files.map((file) => this.uploadProvidedFile({ realm, file }));
    return Promise.all(tasks.map((task) => task.result));
  }

  // Test seam for local-file attachment flow
  __queueLocalFileForTesting(file: File | null) {
    this.queuedLocalFilesForTesting.push(file);
  }

  __queueLocalFileBatchForTesting(files: File[]) {
    this.queuedLocalFileBatchesForTesting.push(files);
  }

  private _openFilePicker(task: FileUploadTask, acceptTypes?: string) {
    this._openNativeFilePicker(acceptTypes).then((file) => {
      task._resolveFile(file);
    });
  }

  private _openNativeFilePicker(acceptTypes?: string): Promise<File | null> {
    let deferred = new Deferred<File | null>();
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptTypes ?? '';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener(
      'change',
      () => {
        deferred.fulfill(input.files?.[0] ?? null);
        input.remove();
      },
      { once: true },
    );
    input.addEventListener(
      'cancel',
      () => {
        deferred.fulfill(null);
        input.remove();
      },
      { once: true },
    );

    input.click();
    return deferred.promise;
  }

  private _openNativeFilePickerMulti(acceptTypes?: string): Promise<File[]> {
    let deferred = new Deferred<File[]>();
    let input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = acceptTypes ?? '';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener(
      'change',
      () => {
        deferred.fulfill(input.files ? Array.from(input.files) : []);
        input.remove();
      },
      { once: true },
    );
    input.addEventListener(
      'cancel',
      () => {
        deferred.fulfill([]);
        input.remove();
      },
      { once: true },
    );

    input.click();
    return deferred.promise;
  }

  private async _processUpload(task: FileUploadTask, realm: RealmIdentifier) {
    try {
      let file = await task.awaitFile();

      if (!file) {
        task.state = 'complete';
        task._fulfill(undefined);
        return;
      }

      // The realm identifies a file by the local path it is written to, and
      // derives everything else — content type, size ceiling, which FileDef
      // subtype it adopts — from that path. A name carrying URL syntax would
      // be truncated on the way there, so it is made safe first and every
      // decision below is made about the name that will actually be stored.
      let uploadName = toSafeFileName(file.name);

      let lastDotIndex = uploadName.lastIndexOf('.');
      if (lastDotIndex <= 0 || lastDotIndex >= uploadName.length - 1) {
        throw new Error(
          `The file "${file.name}" has no extension. Please select a file with an extension (e.g. .png, .txt, .gts).`,
        );
      }

      task.fileName = uploadName;

      // The realm rejects an over-limit write with a 413, but only after the
      // whole body has crossed the wire and been buffered server-side. Checking
      // the size the browser already knows turns that into an immediate error.
      validateByteLength(
        file.size,
        fileSizeLimitFor(uploadName, {
          default: this.environmentService.fileSizeLimitBytes,
          audio: this.environmentService.audioSizeLimitBytes,
          video: this.environmentService.videoSizeLimitBytes,
        }),
        'file',
      );

      task.state = 'uploading';

      let targetId = new RealmPaths(realm).fileRRI(uploadName as LocalPath);

      let response = await this.network.authedFetch(targetId, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      });

      if (!response.ok) {
        let detail = response.statusText || '';
        try {
          let body = await response.json();
          let errorEntry = body?.errors?.[0];
          if (errorEntry?.detail || errorEntry?.message) {
            detail = errorEntry.detail ?? errorEntry.message;
          }
        } catch {
          // response may not be JSON
        }
        throw new Error(
          `Upload of ${file.name} to ${realm} failed: ${response.status}${detail ? ` ${detail}` : ''}`,
        );
      }

      let fileDef = await this.store.getWithoutCache<FileDef>(targetId, {
        type: 'file-meta',
      });
      if (isCardErrorJSONAPI(fileDef)) {
        throw new Error('Failed to load file metadata after upload');
      }

      task.state = 'complete';
      task._fulfill(fileDef);
    } catch (e: any) {
      task.state = 'error';
      task.error = e.message ?? 'Upload failed';
      task._fulfill(undefined);
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'file-upload': FileUploadService;
  }
}
