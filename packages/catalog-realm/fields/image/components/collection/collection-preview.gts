import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import MultipleImageGalleryPreview from './multiple-image-gallery-preview';
import MultipleImageDropzonePreview from './multiple-image-dropzone-preview';

type ImageCollectionVariant = 'list' | 'gallery' | 'dropzone';

interface UploadEntry {
  id: string;
  file: File;
  preview: string;
  uploadedImageUrl?: string;
  selected?: boolean;
  readProgress?: number;
  isReading?: boolean;
  isUploading?: boolean;
  uploadStatus?: 'idle' | 'pending' | 'success' | 'error';
  uploadError?: string;
}

interface CollectionPreviewArgs {
  Args: {
    variant: ImageCollectionVariant;
    entry: UploadEntry;
    allowBatchSelect: boolean;
    allowReorder: boolean;
    sortableGroupId: string;
    sortableDisabled: boolean;
    onRemove: (id: string) => void;
    onToggleSelection: (id: string) => void;
    getProgressStyle: (entry: UploadEntry) => string;
    formatSize?: (bytes: number) => string;
  };
}

export default class CollectionPreview extends GlimmerComponent<CollectionPreviewArgs> {
  <template>
    {{#if (eq @variant 'gallery')}}
      <MultipleImageGalleryPreview
        @entry={{@entry}}
        @allowBatchSelect={{@allowBatchSelect}}
        @allowReorder={{@allowReorder}}
        @sortableGroupId={{@sortableGroupId}}
        @sortableDisabled={{@sortableDisabled}}
        @onRemove={{@onRemove}}
        @onToggleSelection={{@onToggleSelection}}
        @getProgressStyle={{@getProgressStyle}}
      />
    {{else}}
      <MultipleImageDropzonePreview
        @entry={{@entry}}
        @allowBatchSelect={{@allowBatchSelect}}
        @allowReorder={{@allowReorder}}
        @sortableGroupId={{@sortableGroupId}}
        @sortableDisabled={{@sortableDisabled}}
        @onRemove={{@onRemove}}
        @onToggleSelection={{@onToggleSelection}}
        @getProgressStyle={{@getProgressStyle}}
        @formatSize={{@formatSize}}
      />
    {{/if}}
  </template>
}
