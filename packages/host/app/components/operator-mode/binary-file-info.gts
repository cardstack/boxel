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
    <div class='binary-info'>
      {{svgJar 'file' width='40' height='50'}}
      <div class='file-name'>{{this.baseName}}</div>
      <div class='info'>{{this.size}}</div>
      <div class='info'>Last modified {{this.lastModified}}</div>
    </div>

    <style></style>
  </template>
}
