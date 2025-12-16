import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import FileCode from '@cardstack/boxel-icons/file-code';

import { IconButton, Pill } from '@cardstack/boxel-ui/components';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';
import { IconX, Download } from '@cardstack/boxel-ui/icons';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import AttachedFileDropdownMenu from './ai-assistant/attached-file-dropdown-menu';

import type OperatorModeStateService from '../services/operator-mode-state-service';

interface FilePillSignature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    file: FileDef;
    borderType?: 'dashed' | 'solid';
    fileActionsEnabled?: boolean;
    onClick?: () => void;
    onRemove?: () => void;
    onDownload?: () => void;
  };
}

export default class FilePill extends Component<FilePillSignature> {
  @service declare operatorModeStateService: OperatorModeStateService;

  get component() {
    return this.args.file.constructor.getComponent(this.args.file);
  }

  @action
  private handleFileClick() {
    if (this.args.onClick) {
      this.args.onClick();
    }
  }

  @action
  private handleRemoveClick(event: Event) {
    // Prevent the click from bubbling up to the pill button
    event.stopPropagation();
    if (this.args.onRemove) {
      this.args.onRemove();
    }
  }

  @action
  private handleDownloadClick(event: Event) {
    // Prevent the click from bubbling up to the pill button
    event.stopPropagation();
    if (this.args.onDownload) {
      this.args.onDownload();
    }
  }

  private get pillKind() {
    return this.args.onClick ? 'button' : 'default';
  }

  private get borderStyle() {
    return this.args.borderType === 'dashed' ? 'dashed' : 'solid';
  }

  private get borderClass() {
    return `border-${this.borderStyle}`;
  }

  <template>
    <Pill
      @kind={{this.pillKind}}
      class={{cn 'file-pill' this.borderClass}}
      data-test-attached-file={{@file.sourceUrl}}
      {{on 'click' this.handleFileClick}}
      ...attributes
    >
      <:iconLeft>
        <FileCode
          width='18'
          height='18'
          style={{cssVar icon-color='#0031ff'}}
        />
      </:iconLeft>
      <:default>
        <div class='file-content' title={{@file.name}}>
          <this.component @format='atom' @displayContainer={{false}} />
        </div>
      </:default>
      <:iconRight>
        {{#if @onRemove}}
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            @height='10'
            @width='10'
            {{on 'click' this.handleRemoveClick}}
            data-test-remove-file-btn
          />
        {{/if}}
        {{#if @onDownload}}
          <IconButton
            class='download-button'
            @icon={{Download}}
            @height='10'
            @width='10'
            {{on 'click' this.handleDownloadClick}}
            data-test-download-file-btn
          />
        {{/if}}

        {{#if @fileActionsEnabled}}
          <AttachedFileDropdownMenu @file={{@file}} @isNewFile={{false}} />
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
      .border-dashed {
        border-style: dashed;
      }
      .border-solid {
        border-style: solid;
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
