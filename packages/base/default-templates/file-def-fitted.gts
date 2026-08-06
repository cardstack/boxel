import GlimmerComponent from '@glimmer/component';

import { filePreviewComponentFor } from '../file-formats/file-preview-stage';
import { FileFittedShell } from '../file-formats/file-shell-fitted';
import {
  fileProfileSource,
  fileViewModel,
} from '../file-formats/file-view-model';

import type { FileDef } from '../card-api';

export default class FileDefFittedTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
    fields?: Record<string, any>;
    cardOrField?: unknown;
  };
}> {
  // The `fitted` projection applies the collection-cell work budgets, so the
  // shell and any family renderer physically cannot receive an unbounded
  // payload to turn into HTML.
  get viewModel() {
    return fileViewModel(
      this.args.model,
      'fitted',
      fileProfileSource(this.args.model, this.args.cardOrField),
    );
  }

  get preview() {
    return filePreviewComponentFor(this.args.model, this.args.cardOrField);
  }

  <template>
    <FileFittedShell
      @model={{this.viewModel}}
      @fields={{@fields}}
      @preview={{this.preview}}
    />
  </template>
}
