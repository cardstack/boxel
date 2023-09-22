import Component from '@glimmer/component';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { filesize } from 'filesize';
import { format } from 'date-fns';
import { type Ready } from '@cardstack/host/resources/file';

interface Signature {
  Element: HTMLElement;
  Args: {
    readyFile: Ready;
  };
}

export default class BinaryFileInfo extends Component<Signature> {
  get baseName() {
    return this.args.readyFile.url.split('/').pop()!;
  }

  get size() {
    return filesize(this.args.readyFile.size);
  }

  get lastModified() {
    if (this.args.readyFile.lastModifiedAsDate) {
      return format(
        this.args.readyFile.lastModifiedAsDate,
        'MMM d, yyyy H:mm:ss a',
      );
    }
    return;
  }

  <template>
    <div class='binary-info' data-test-binary-info>
      <div class='file-icon'>
        {{svgJar 'file' width='50' height='60'}}
      </div>
      <div class='file-name' data-test-file-name>{{this.baseName}}</div>
      <div class='info size' data-test-size>{{this.size}}</div>
      <div class='info' data-test-last-modified>Last modified
        {{this.lastModified}}</div>
    </div>

    <style>
      .binary-info {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        text-align: center;
        height: 100%;
      }
      .file-name {
        margin-top: var(--boxel-sp);
        font: var(--boxel-font-med);
        font-weight: bold;
        width: 100%;
      }
      .info {
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        width: 100%;
      }
      .size {
        margin-top: var(--boxel-sp-xxs);
        text-transform: uppercase;
      }
      .file-icon {
        --icon-color: var(--boxel-highlight);
        width: 100%;
      }
    </style>
  </template>
}
