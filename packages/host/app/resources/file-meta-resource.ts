import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';

import { Resource } from 'ember-modify-based-class-resource';

import type { CardErrorJSONAPI } from '@cardstack/runtime-common';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import type StoreService from '../services/store';

function isFileDefInstance(value: unknown): value is FileDef {
  return Boolean(
    (value as { constructor?: { isFileDef?: boolean } })?.constructor?.isFileDef,
  );
}

interface Args {
  named: {
    id: string | undefined;
  };
}

export class FileMetaResource extends Resource<Args> {
  #id: string | undefined;
  #hasRegisteredDestructor = false;
  #hasReference = false;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    let { id } = named;
    if (id !== this.#id) {
      this.dropReferenceIfHeld();
      this.#id = id;
      if (this.#id) {
        this.store.addReference(this.#id, 'file-meta');
        this.#hasReference = true;
      }
    }
    if (!this.#hasRegisteredDestructor) {
      this.#hasRegisteredDestructor = true;
      registerDestructor(this, () => {
        this.dropReferenceIfHeld();
      });
    }
  }

  private dropReferenceIfHeld() {
    if (this.#id && this.#hasReference) {
      this.store.dropReference(this.#id, 'file-meta');
      this.#hasReference = false;
    }
  }

  get file(): FileDef | undefined {
    if (!this.#id) {
      return undefined;
    }
    let maybeFile = this.store.peek(this.#id, 'file-meta') as unknown;
    return isFileDefInstance(maybeFile) ? maybeFile : undefined;
  }

  get fileError(): CardErrorJSONAPI | undefined {
    if (!this.#id) {
      return undefined;
    }
    return this.store.peekError(this.#id, 'file-meta');
  }

  get id() {
    return this.#id;
  }

  get isLoaded() {
    if (!this.#id) {
      return false;
    }
    return Boolean(this.store.peek(this.#id, 'file-meta'));
  }
}

export function getFileMeta(parent: object, id: () => string | undefined) {
  return FileMetaResource.from(parent, () => ({
    named: {
      id: id(),
    },
  }));
}
