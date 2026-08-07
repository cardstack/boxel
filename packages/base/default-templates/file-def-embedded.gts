import GlimmerComponent from '@glimmer/component';

import { filePreviewComponentFor } from '../file-formats/file-preview-stage';
import { FileEmbeddedShell } from '../file-formats/file-shell-embedded';
import {
  fileProfileSource,
  fileViewModel,
} from '../file-formats/file-view-model';

import type { FileDef } from '../card-api';

export default class FileDefEmbeddedTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
    fields?: Record<string, any>;
    cardOrField?: unknown;
  };
}> {
  get viewModel() {
    return fileViewModel(
      this.args.model,
      'embedded',
      fileProfileSource(this.args.model, this.args.cardOrField),
    );
  }

  get preview() {
    return filePreviewComponentFor(this.args.model, this.args.cardOrField);
  }

  <template>
    <FileEmbeddedShell
      @model={{this.viewModel}}
      @fields={{@fields}}
      @preview={{this.preview}}
    />
  </template>
}
