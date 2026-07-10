import GlimmerComponent from '@glimmer/component';
import FileIcon from '@cardstack/boxel-icons/file';
import type { FileDef } from '../card-api';

export default class FileDefEmbeddedTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
  };
}> {
  <template>
    <div class='file-embedded' data-test-file-embedded>
      <FileIcon class='file-embedded__icon' width='20' height='20' />
      <span class='file-embedded__name'>{{@model.name}}</span>
    </div>
    <style scoped>
      .file-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        width: 100%;
        min-width: 0;
      }

      .file-embedded__icon {
        color: var(--boxel-600);
        flex-shrink: 0;
      }

      .file-embedded__name {
        font-weight: 600;
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }
    </style>
  </template>
}
