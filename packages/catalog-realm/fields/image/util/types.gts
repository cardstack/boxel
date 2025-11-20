// Only allow these specific image MIME types
type AllowedImageType = 'image/jpeg' | 'image/png' | 'image/gif';

// Single Upload Type
export interface SingleUploadConfig {
  type: 'single';
  placeholder?: string;
  features?: Array<'drag-drop' | 'validated' | 'progress'>;
  validation?: {
    maxFileSize?: number; // in bytes
    allowedFormats?: AllowedImageType[];
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: string;
  };
  uploadOptions?: {
    dragDrop?: {
      dropzoneLabel?: string;
    };
  };
}

// Multiple Upload Type
export interface MultipleUploadConfig {
  type: 'multiple';
  showFileSize?: boolean;
  features?: Array<'drag-drop' | 'reorder' | 'validated' | 'progress'>;
  validation?: {
    maxFileSize?: number;
    maxFiles?: number;
    allowedFormats?: AllowedImageType[];
  };
  uploadOptions?: {
    dragDrop?: {
      dropzoneLabel?: string;
    };
  };
  reorderOptions?: {
    enabled: boolean;
    handleClass?: string;
    ghostClass?: string;
    chosenClass?: string;
    animation?: number;
  };
}

// Avatar Upload Type
export interface AvatarUploadConfig {
  type: 'avatar';
  circular?: boolean;
  features?: Array<'drag-drop' | 'validated' | 'progress'>;
  validation?: {
    maxFileSize?: number;
    allowedFormats?: AllowedImageType[];
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: '1/1';
  };
  uploadOptions?: {
    dragDrop?: {
      dropzoneLabel?: string;
    };
  };
}

// Gallery Upload Type
export interface GalleryUploadConfig {
  type: 'gallery';
  itemSize?: string;
  gap?: string;
  allowBatchSelect?: boolean;
  features?: Array<
    'drag-drop' | 'reorder' | 'validated' | 'progress' | 'batch-select'
  >;
  validation?: {
    maxFileSize?: number;
    maxFiles?: number;
    allowedFormats?: AllowedImageType[];
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: string;
  };
  uploadOptions?: {
    dragDrop?: {
      dropzoneLabel?: string;
    };
  };
  reorderOptions?: {
    enabled: boolean;
    handleClass?: string;
    ghostClass?: string;
    chosenClass?: string;
    animation?: number;
  };
}

export type UploadConfig =
  | SingleUploadConfig
  | MultipleUploadConfig
  | AvatarUploadConfig
  | GalleryUploadConfig;
