// Pretui — FileUpload usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FileUpload } from './file-upload';
import type { UploadFile } from './file-upload';

const START: UploadFile[] = [
  { id: 'a', name: 'lot-7-label.pdf', size: 204800, status: 'done' },
  { id: 'b', name: 'cupping-notes.docx', size: 51200, status: 'uploading', progress: 64 },
  { id: 'c', name: 'roast-curve.csv', size: 1024, status: 'error', error: 'The server refused the file.' },
];

export class FileUploadUsage extends Component {
  @tracked files: UploadFile[] = START;
  private next = 1;
  add = (picked: File[]) => {
    let rows = picked.map((f) => ({ id: `new-${this.next++}`, name: f.name, size: f.size, status: 'queued' as const }));
    this.files = [...this.files, ...rows];
  };
  remove = (file: UploadFile) => (this.files = this.files.filter((f) => f.id !== file.id));
  retry = (file: UploadFile) =>
    (this.files = this.files.map((f) => (f.id === file.id ? { ...f, status: 'uploading' as const, progress: 10, error: undefined } : f)));
  get usage() {
    return "<FileUpload @files={{this.files}} @onAdd={{this.upload}} @onRetry={{this.retry}} @onRemove={{this.remove}} @max={{5}} />";
  }
  <template>
    <FreestyleUsage
      @name='FileUpload'
      @description='The list of files being uploaded, under a drop target: name, size, a progress bar while uploading, a status in words, and named Retry and Remove. It holds no bytes and runs no request; the caller owns the list and updates each file. This demo only queues what you add.'
      @source={{this.usage}}
    >
      <:example>
        <div class='fu-demo'>
          <FileUpload @files={{this.files}} @onAdd={{this.add}} @onRetry={{this.retry}} @onRemove={{this.remove}} @max={{5}} @label='Lot documents' @hint='PDF, DOCX or CSV' />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object @name='files' @required={{true}} @description='{ id, name, size?, status, progress?, error? }[] owned by the caller.' />
        <Args.Action @name='onAdd' @description='The files dropped or browsed for, cut to the room under max.' />
        <Args.Action @name='onReject' @description='What the drop target refused, with the reason.' />
        <Args.Action @name='onRetry' @description='Shows Retry on failed rows.' />
        <Args.Action @name='onRemove' @description='Shows Remove on every row.' />
        <Args.String @name='accept' />
        <Args.Bool @name='multiple' @defaultValue={{true}} />
        <Args.Number @name='max' @description='At most this many files; the drop target hides at the limit.' />
        <Args.Number @name='maxSize' @description='Per-file byte limit.' />
        <Args.String @name='label' />
        <Args.String @name='hint' />
        <Args.Bool @name='disabled' @defaultValue={{false}} />
        <Args.Yield @name='trigger' @description='Replaces the default Dropzone.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .fu-demo {
        max-inline-size: 30rem;
      }
    </style>
  </template>
}

export const DEMOS_FILE_UPLOAD: Record<string, unknown> = {
  FileUpload: FileUploadUsage,
};
