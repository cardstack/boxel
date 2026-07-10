import GlimmerComponent from '@glimmer/component';
import FileIcon from '@cardstack/boxel-icons/file';
import type { FileDef } from '../card-api';

export default class FileDefFittedTemplate extends GlimmerComponent<{
  Args: {
    model: FileDef;
  };
}> {
  <template>
    <article class='file-fitted' data-test-file-fitted>
      <div class='file-fitted__icon'>
        <FileIcon width='100%' height='100%' />
      </div>
      <header class='file-fitted__name'>{{@model.name}}</header>
    </article>
    <style scoped>
      .file-fitted {
        container-name: fitted-card;
        container-type: size;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }

      .file-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .file-fitted__name {
        min-width: 0;
        flex: 1;
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      /* Portrait tall: icon above name, centered */
      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .file-fitted {
          flex-direction: column;
          text-align: center;
        }

        .file-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .file-fitted__name {
          -webkit-line-clamp: 3;
        }
      }

      /* Portrait very short: hide icon */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .file-fitted__icon {
          display: none;
        }
      }

      /* Very small: name only, smaller font */
      @container fitted-card (height <= 57px) {
        .file-fitted__icon {
          display: none;
        }

        .file-fitted__name {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}
