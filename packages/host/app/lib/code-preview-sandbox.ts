import { tracked } from '@glimmer/tracking';

export const CodePreviewSandboxContextName = 'code-preview-sandbox';

let nextPreviewSandbox = 0;

// One instance belongs to one mounted Code mode surface. The unsaved Monaco
// buffer is deliberately held outside the Store and ordinary realm loaders so
// an editor can evaluate drafts without changing Interact or another preview.
export default class CodePreviewSandbox {
  readonly id = `code-preview-${++nextPreviewSandbox}`;
  active = true;

  @tracked sourceURL?: string;
  @tracked source?: string;
  @tracked revision = 0;

  update(sourceURL: string, source: string) {
    if (this.sourceURL === sourceURL && this.source === source) {
      return;
    }
    this.sourceURL = sourceURL;
    this.source = source;
    this.revision++;
  }

  deactivate() {
    this.active = false;
  }
}
