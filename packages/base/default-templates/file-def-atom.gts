import GlimmerComponent from '@glimmer/component';

import {
  fileProfileSource,
  fileViewModel,
} from '../file-formats/file-view-model';
import { FileAtomShell } from '../file-formats/file-shell-atom';

import type { FileDef } from '../card-api';

export default class FileDefAtomTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
    cardOrField?: unknown;
  };
}> {
  get viewModel() {
    return fileViewModel(
      this.args.model,
      'atom',
      fileProfileSource(this.args.model, this.args.cardOrField),
    );
  }

  <template><FileAtomShell @model={{this.viewModel}} /></template>
}
