import { concat } from '@ember/helper';
import FileIcon from '@cardstack/boxel-icons/file';
import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import { copyCardURLToClipboard } from '@cardstack/boxel-ui/helpers';
import {
  byteStreamToUint8Array,
  getMenuItems,
  inferContentType,
} from '@cardstack/runtime-common';
import { md5 } from 'super-fast-md5';
import {
  BaseDef,
  BaseDefComponent,
  Component,
  GetMenuItemParams,
  ReadOnlyField,
  StringField,
  contains,
  field,
  getDataBucket,
} from './card-api';
import LinkIcon from '@cardstack/boxel-icons/link';
import OpenInInteractModeCommand from '@cardstack/boxel-host/commands/open-in-interact-mode';
import Eye from '@cardstack/boxel-icons/eye';
import SwitchSubmodeCommand from '@cardstack/boxel-host/commands/switch-submode';
import CodeIcon from '@cardstack/boxel-icons/code';
import { isSavedInstance } from './-private';

class View extends Component<typeof FileDef> {
  <template>
    {{@model.name}}
  </template>
}

class Edit extends Component<typeof FileDef> {
  <template>
    <div class='filedef-edit-unavailable' data-test-filedef-edit-unavailable>
      This file
      {{if @model.id (concat ' (' @model.id ')')}}
      is not editable via this interface. Replace it via file upload.
    </div>
    <style scoped>
      .filedef-edit-unavailable {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-radius-sm);
        color: var(--boxel-700);
        font-size: var(--boxel-font-sm);
        padding: var(--boxel-sp-md);
      }
    </style>
  </template>
}

export type SerializedFile<Extra extends object = {}> = {
  sourceUrl: string;
  url: string;
  name: string;
  contentType: string;
  contentHash?: string;
} & Extra;

export type ByteStream = ReadableStream<Uint8Array> | Uint8Array;

// Throw this error from extractAttributes when the file content doesn't match this FileDef's
// expectations so the extractor can fall back to a superclass/base FileDef.
export class FileContentMismatchError extends Error {
  name = 'FileContentMismatchError';
}

export class FileDef extends BaseDef {
  static displayName = 'File';
  static isFileDef = true;
  static icon = FileIcon;
  [isSavedInstance] = true;

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    if (fieldName === 'id') {
      // Similar to CardDef, set 'id' directly in the deserialized cache
      // to avoid triggering recomputes during instantiation
      let deserialized = getDataBucket(instance);
      deserialized.set('id', value);
    } else {
      super.assignInitialFieldValue(instance, fieldName, value);
    }
  }

  @field id = contains(ReadOnlyField);
  @field sourceUrl = contains(StringField);
  @field url = contains(StringField);
  @field name = contains(StringField);
  @field contentType = contains(StringField);
  @field contentHash = contains(StringField);

  static embedded: BaseDefComponent = View;
  static fitted: BaseDefComponent = View;
  static isolated: BaseDefComponent = View;
  static atom: BaseDefComponent = View;
  static edit: BaseDefComponent = Edit;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<SerializedFile> {
    let parsed = new URL(url);
    let name = parsed.pathname.split('/').pop() ?? parsed.pathname;
    let contentType = inferContentType(name);
    let contentHash: string | undefined = options.contentHash;
    if (!contentHash) {
      let bytes = await byteStreamToUint8Array(await getStream());
      try {
        contentHash = md5(bytes);
      } catch {
        contentHash = md5(new TextDecoder().decode(bytes));
      }
    }

    return {
      sourceUrl: url,
      url,
      name,
      contentType,
      contentHash,
    };
  }

  serialize() {
    return {
      sourceUrl: this.sourceUrl,
      url: this.url,
      name: this.name,
      contentType: this.contentType,
      contentHash: this.contentHash,
    };
  }

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    return getDefaultFileMenuItems(this, params);
  }
}

export interface SerializedFileDef {
  url?: string;
  sourceUrl: string;
  name?: string;
  contentHash?: string;
  contentType?: string;
  content?: string;
  error?: string;
}

export function createFileDef({
  url,
  sourceUrl,
  name,
  contentType,
  contentHash,
}: SerializedFileDef) {
  return new FileDef({ url, sourceUrl, name, contentType, contentHash });
}

export function getDefaultFileMenuItems(
  fileDefInstance: FileDef,
  params: GetMenuItemParams,
): MenuItemOptions[] {
  let fileDefInstanceId = fileDefInstance.id as unknown as string;
  let menuItems: MenuItemOptions[] = [];
  if (
    ['interact', 'code-mode-preview', 'code-mode-playground'].includes(
      params.menuContext,
    )
  ) {
    menuItems.push({
      label: 'Copy File URL',
      action: () => copyCardURLToClipboard(fileDefInstanceId),
      icon: LinkIcon,
      disabled: !fileDefInstanceId,
    });
  }
  if (params.menuContext === 'interact') {
    if (fileDefInstanceId && params.canEdit) {
      // TODO: add menu item to delete the file
    }
  }
  if (
    params.menuContext === 'ai-assistant' &&
    params.menuContextParams.canEditActiveRealm
  ) {
    // TODO: add a CopyFileCommand menu item once we have that command
  }
  if (
    ['code-mode-preview', 'code-mode-playground'].includes(params.menuContext)
  ) {
    menuItems.push({
      label: 'Open in Interact Mode',
      action: () => {
        new OpenInInteractModeCommand(params.commandContext).execute({
          cardId: fileDefInstanceId,
          format: params.format === 'edit' ? 'edit' : 'isolated',
        });
      },
      icon: Eye,
    });
  }
  if (params.menuContext === 'code-mode-playground') {
    menuItems.push({
      label: 'Open in Code Mode',
      action: async () => {
        await new SwitchSubmodeCommand(params.commandContext).execute({
          submode: 'code',
          codePath: fileDefInstanceId
            ? new URL(fileDefInstanceId).href
            : undefined,
        });
      },
      icon: CodeIcon,
    });
  }
  return menuItems;
}
