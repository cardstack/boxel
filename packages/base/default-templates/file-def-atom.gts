import GlimmerComponent from '@glimmer/component';
import FileIcon from '@cardstack/boxel-icons/file';
import type { FileDef } from '../card-api';

export default class FileDefAtomTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
  };
}> {
  <template>
    <span class='file-atom' data-test-file-atom>
      <FileIcon class='file-atom__icon' width='16' height='16' />
      <span class='file-atom__name'>{{@model.name}}</span>
    </span>
    <style scoped>
      .file-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .file-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .file-atom__name {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}
