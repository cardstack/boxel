import type {
  FileMetaResource,
  LooseLinkableResource,
  LooseSingleResourceDocument,
} from '@cardstack/runtime-common';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import StoreService from './store';

export default class RenderStoreService extends StoreService {
  protected override isRenderStore = true;

  async addFileMeta(
    resource: LooseLinkableResource<FileMetaResource>,
    doc: LooseSingleResourceDocument<FileMetaResource>,
    relativeTo: URL | undefined,
  ): Promise<FileDef> {
    return this.createFileMetaFromSerialized(resource, doc, relativeTo);
  }
}

declare module '@ember/service' {
  interface Registry {
    'render-store': RenderStoreService;
  }
}
