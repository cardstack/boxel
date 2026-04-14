import GlimmerComponent from '@glimmer/component';
import { concat } from '@ember/helper';
import type { FileDef } from '../card-api';

export default class FileDefEditTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
  };
}> {
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
