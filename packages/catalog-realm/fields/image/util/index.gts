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

import type { FieldConfigMap, UploadConfig } from './types';
import SingleUploadField from '../single';
import MultipleUploadField from '../multiple';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
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

const FIELD_TYPE_MAP: Record<keyof FieldConfigMap, any> = {
  single: SingleUploadField,
  multiple: MultipleUploadField,
  avatar: null, // Will be implemented
  gallery: null, // Will be implemented
};

export function getFieldClass(type?: keyof FieldConfigMap): any | null {
  if (!type) return null;
  return FIELD_TYPE_MAP[type] ?? null;
}
