import GlimmerComponent from '@glimmer/component';
import FileIcon from '@cardstack/boxel-icons/file';
import type { FileDef } from '../card-api';

export default class FileDefIsolatedTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
  };
}> {
  <template>
    <div class='file-isolated' data-test-file-isolated>
      <FileIcon class='file-isolated__icon' width='32' height='32' />
      <div class='file-isolated__name'>{{@model.name}}</div>
    </div>
    <style scoped>
      .file-isolated {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .file-isolated__icon {
        color: var(--boxel-600);
        flex-shrink: 0;
      }

      .file-isolated__name {
        font-weight: 600;
        color: var(--boxel-900);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }
    </style>
  </template>
}
