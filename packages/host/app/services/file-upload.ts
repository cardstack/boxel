import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import {
  Deferred,
  RealmPaths,
  isCardErrorJSONAPI,
  type LocalPath,
} from '@cardstack/runtime-common';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import type NetworkService from './network';
import type StoreService from './store';

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
  @service declare private network: NetworkService;
  @service declare private store: StoreService;

  @tracked activeUploads: FileUploadTask[] = [];

  uploadFile(opts: { realmURL: URL; acceptTypes?: string }): FileUploadTask {
    let task = new FileUploadTask();
    this._startTask(task, opts.realmURL);

    if (!isTesting()) {
      this._openFilePicker(task, opts.acceptTypes);
    }

    return task;
  }

  uploadProvidedFile(opts: { realmURL: URL; file: File }): FileUploadTask {
    let task = new FileUploadTask();
    this._startTask(task, opts.realmURL);
    task._resolveFile(opts.file);

    return task;
  }

  private _startTask(task: FileUploadTask, realmURL: URL) {
    this.activeUploads = [...this.activeUploads, task];
    this._processUpload(task, realmURL).finally(() => {
      this.activeUploads = this.activeUploads.filter((t) => t !== task);
    });
  }

  private _openFilePicker(task: FileUploadTask, acceptTypes?: string) {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptTypes ?? '';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener(
      'change',
      () => {
        task._resolveFile(input.files?.[0] ?? null);
        input.remove();
      },
      { once: true },
    );
    input.addEventListener(
      'cancel',
      () => {
        task._resolveFile(null);
        input.remove();
      },
      { once: true },
    );

    input.click();
  }

  private async _processUpload(task: FileUploadTask, realmURL: URL) {
    try {
      let file = await task.awaitFile();

      if (!file) {
        task.state = 'complete';
        task._fulfill(undefined);
        return;
      }

      let lastDotIndex = file.name.lastIndexOf('.');
      if (lastDotIndex <= 0 || lastDotIndex >= file.name.length - 1) {
        throw new Error(
          `The file "${file.name}" has no extension. Please select a file with an extension (e.g. .png, .txt, .gts).`,
        );
      }

      task.fileName = file.name;
      task.state = 'uploading';

      let targetUrl = new RealmPaths(realmURL).fileURL(file.name as LocalPath);

      let response = await this.network.authedFetch(targetUrl, {
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
          `Upload of ${file.name} to ${realmURL.href} failed: ${response.status}${detail ? ` ${detail}` : ''}`,
        );
      }

      let fileDef = await this.store.getWithoutCache<FileDef>(targetUrl.href, {
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
