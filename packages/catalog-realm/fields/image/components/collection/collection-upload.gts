import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import MultipleImageGalleryUpload from './multiple-image-gallery-upload';
import MultipleImageDropzoneUpload from './multiple-image-dropzone-upload';

type ImageCollectionVariant = 'list' | 'gallery' | 'dropzone';

interface CollectionUploadArgs {
  Args: {
    variant: ImageCollectionVariant;
    onFileSelect: (event: Event) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    maxFilesReached: boolean;
    currentCount: number;
    maxFiles: number;
  };
}

export default class CollectionUpload extends GlimmerComponent<CollectionUploadArgs> {
  <template>
    {{#if (eq @variant 'gallery')}}
      <MultipleImageGalleryUpload
        @onFileSelect={{@onFileSelect}}
        @onDragOver={{@onDragOver}}
        @onDrop={{@onDrop}}
        @maxFilesReached={{@maxFilesReached}}
        @currentCount={{@currentCount}}
        @maxFiles={{@maxFiles}}
      />
    {{else}}
      <MultipleImageDropzoneUpload
        @onFileSelect={{@onFileSelect}}
        @onDragOver={{@onDragOver}}
        @onDrop={{@onDrop}}
        @maxFilesReached={{@maxFilesReached}}
        @currentCount={{@currentCount}}
        @maxFiles={{@maxFiles}}
        @variant={{@variant}}
      />
    {{/if}}
  </template>
}
