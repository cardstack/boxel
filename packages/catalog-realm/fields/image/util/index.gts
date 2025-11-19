// Export all types
export type {
  UploadVariant,
  UploadFeatures,
  BaseUploadConfig,
  SingleUploadConfig,
  MultipleUploadConfig,
  AvatarUploadConfig,
  GalleryUploadConfig,
  UploadConfig,
  ImageValidationConfig,
  UploadProgressConfig,
  CameraConfig,
  FieldConfigMap,
} from './types';

import type {
  FieldConfigMap,
  MultipleUploadConfig,
  SingleUploadConfig,
  UploadConfig,
} from './types';

export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 Bytes';
  }
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${value} ${sizes[i]}`;
}

export function isValidImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isAllowedFormat(
  file: File,
  allowedFormats?: string[],
): boolean {
  if (!allowedFormats || allowedFormats.length === 0) {
    return true;
  }
  const fileExtension = file.type.split('/')[1];
  return allowedFormats.includes(fileExtension);
}

export function validateFileSize(file: File, maxSize?: number): boolean {
  if (!maxSize) return true;
  return file.size <= maxSize;
}

export function loadImageDimensions(
  file: File,
): Promise<{ width: number; height: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        resolve({
          width: img.width,
          height: img.height,
          dataUrl,
        });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Type guard to check if config is for a specific variant
 */
export function isSingleUploadConfig(
  config: UploadConfig,
): config is SingleUploadConfig {
  return config.type === 'single';
}

export function isMultipleUploadConfig(
  config: UploadConfig,
): config is MultipleUploadConfig {
  return config.type === 'multiple';
}

export function isAvatarUploadConfig(
  config: UploadConfig,
): config is AvatarUploadConfig {
  return config.type === 'avatar';
}

export function isGalleryUploadConfig(
  config: UploadConfig,
): config is GalleryUploadConfig {
  return config.type === 'gallery';
}

/**
 * Check if a feature is enabled in the configuration
 */
export function hasFeature(
  config: UploadConfig,
  feature: keyof UploadFeatures,
): boolean {
  return Boolean(config.features?.[feature]);
}

const SINGLE_UPLOAD_DEFAULT: SingleUploadConfig = {
  type: 'single',
  maxSize: 10 * 1024 * 1024,
  allowedFormats: ['jpeg', 'jpg', 'png', 'gif'],
  showPreview: true,
  showFileName: true,
  showFileSize: true,
  placeholder: 'Click to upload',
};

const MULTIPLE_UPLOAD_DEFAULT: MultipleUploadConfig = {
  type: 'multiple',
  maxSize: 10 * 1024 * 1024,
  maxFiles: 10,
  allowedFormats: ['jpeg', 'jpg', 'png', 'gif'],
  scrollable: true,
  showPreview: true,
  showFileName: true,
  showFileSize: true,
  placeholder: 'Click to upload image',
};

export function mergeSingleUploadConfig(
  overrides?: SingleUploadConfig,
): SingleUploadConfig {
  return {
    ...SINGLE_UPLOAD_DEFAULT,
    ...(overrides || {}),
    type: 'single',
    allowedFormats:
      overrides?.allowedFormats && overrides.allowedFormats.length
        ? overrides.allowedFormats
        : SINGLE_UPLOAD_DEFAULT.allowedFormats,
  };
}

export function mergeMultipleUploadConfig(
  overrides?: MultipleUploadConfig,
): MultipleUploadConfig {
  return {
    ...MULTIPLE_UPLOAD_DEFAULT,
    ...(overrides || {}),
    type: 'multiple',
    allowedFormats:
      overrides?.allowedFormats && overrides.allowedFormats.length
        ? overrides.allowedFormats
        : MULTIPLE_UPLOAD_DEFAULT.allowedFormats,
  };
}

export function buildUploadHint(
  allowedFormats?: string[],
  maxSize?: number,
  fallback = '',
): string {
  if (allowedFormats?.length && typeof maxSize === 'number') {
    const formats = allowedFormats.join(', ').toUpperCase();
    const readableSize = formatFileSize(maxSize);
    return `${formats} up to ${readableSize}`;
  }
  return fallback;
}

export function generateUploadId(): string {
  const cryptoObj = (globalThis as any)?.crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}
