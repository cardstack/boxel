import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';

import FileCode from '@cardstack/boxel-icons/file-code';

import { IconButton, Pill } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { type FileDef } from 'https://cardstack.com/base/file-api';

interface FilePillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    file: FileDef;
    isAutoAttachedFile?: boolean;
    removeFile?: (file: FileDef) => void;
  };
}

export default class FilePill extends Component<FilePillSignature> {
  get component() {
    return this.args.file.constructor.getComponent(this.args.file);
  }

  <template>
    <Pill
      class={{cn 'file-pill' is-autoattached=@isAutoAttachedFile}}
      data-test-attached-file={{@file.sourceUrl}}
      data-test-autoattached-file={{@isAutoAttachedFile}}
      ...attributes
    >
      <:iconLeft>
        <FileCode />
      </:iconLeft>
      <:default>
        <div class='file-content' title={{@file.name}}>
          <this.component @format='atom' @displayContainer={{false}} />
        </div>
      </:default>
      <:iconRight>
        {{#if @removeFile}}
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            @height='10'
            @width='10'
            {{on 'click' (fn @removeFile @file)}}
            data-test-remove-file-btn
          />
        {{/if}}
      </:iconRight>
    </Pill>
    <style scoped>
      .file-pill {
        --pill-icon-size: 16px;
        --boxel-realm-icon-size: var(--pill-icon-size);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height, 1.875rem);
        overflow: hidden;
        padding-left: 3px;
      }
      .is-autoattached {
        border-style: dashed;
      }

      .file-content {
        max-width: 100px;
        max-height: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .remove-button {
        --boxel-icon-button-width: var(--boxel-icon-sm);
        --boxel-icon-button-height: var(--boxel-icon-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--boxel-border-radius-xs);
      }
    </style>
  </template>
}
