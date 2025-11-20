// Export all types
export type {
  SingleUploadConfig,
  MultipleUploadConfig,
  AvatarUploadConfig,
  GalleryUploadConfig,
  UploadConfig,
} from './types';

import type {
  MultipleUploadConfig,
  SingleUploadConfig,
  AvatarUploadConfig,
  GalleryUploadConfig,
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
  feature: 'drag-drop' | 'reorder' | 'validated' | 'progress' | 'batch-select',
): boolean {
  return (config.features as string[] | undefined)?.includes(feature) || false;
}

const SINGLE_UPLOAD_DEFAULT: SingleUploadConfig = {
  type: 'single',
  placeholder: 'Click to upload',
  features: [],
  validation: {
    maxFileSize: 10 * 1024 * 1024,
    allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
  },
};

const MULTIPLE_UPLOAD_DEFAULT: MultipleUploadConfig = {
  type: 'multiple',
  showFileSize: true,
  features: [],
  validation: {
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 10,
    allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
  },
};

const GALLERY_UPLOAD_DEFAULT: GalleryUploadConfig = {
  type: 'gallery',
  itemSize: '200px',
  gap: '1rem',
  allowBatchSelect: true,
  features: [],
  validation: {
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 50,
    allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
  },
};

export function mergeSingleUploadConfig(
  overrides?: Partial<SingleUploadConfig>,
): SingleUploadConfig {
  return {
    ...SINGLE_UPLOAD_DEFAULT,
    ...overrides,
    type: 'single',
    validation: {
      ...SINGLE_UPLOAD_DEFAULT.validation,
      ...overrides?.validation,
    },
    uploadOptions: overrides?.uploadOptions
      ? {
          dragDrop: {
            ...SINGLE_UPLOAD_DEFAULT.uploadOptions?.dragDrop,
            ...overrides.uploadOptions.dragDrop,
          },
        }
      : SINGLE_UPLOAD_DEFAULT.uploadOptions,
  };
}

export function mergeMultipleUploadConfig(
  overrides?: Partial<MultipleUploadConfig>,
): MultipleUploadConfig {
  return {
    ...MULTIPLE_UPLOAD_DEFAULT,
    ...overrides,
    type: 'multiple',
    validation: {
      ...MULTIPLE_UPLOAD_DEFAULT.validation,
      ...overrides?.validation,
    },
    uploadOptions: overrides?.uploadOptions
      ? {
          dragDrop: {
            ...MULTIPLE_UPLOAD_DEFAULT.uploadOptions?.dragDrop,
            ...overrides.uploadOptions.dragDrop,
          },
        }
      : MULTIPLE_UPLOAD_DEFAULT.uploadOptions,
    reorderOptions: overrides?.reorderOptions
      ? {
          ...MULTIPLE_UPLOAD_DEFAULT.reorderOptions,
          ...overrides.reorderOptions,
        }
      : MULTIPLE_UPLOAD_DEFAULT.reorderOptions,
  };
}

export function mergeGalleryUploadConfig(
  overrides?: Partial<GalleryUploadConfig>,
): GalleryUploadConfig {
  return {
    ...GALLERY_UPLOAD_DEFAULT,
    ...overrides,
    type: 'gallery',
    validation: {
      ...GALLERY_UPLOAD_DEFAULT.validation,
      ...overrides?.validation,
    },
    uploadOptions: overrides?.uploadOptions
      ? {
          dragDrop: {
            ...GALLERY_UPLOAD_DEFAULT.uploadOptions?.dragDrop,
            ...overrides.uploadOptions.dragDrop,
          },
        }
      : GALLERY_UPLOAD_DEFAULT.uploadOptions,
    reorderOptions: overrides?.reorderOptions
      ? {
          ...GALLERY_UPLOAD_DEFAULT.reorderOptions,
          ...overrides.reorderOptions,
        }
      : GALLERY_UPLOAD_DEFAULT.reorderOptions,
  };
}

export function buildUploadHint(
  allowedFormats?: ('image/jpeg' | 'image/png' | 'image/gif')[],
  maxSize?: number,
): string {
  const parts: string[] = [];

  if (allowedFormats?.length) {
    const formats = allowedFormats.map((f) => f.split('/')[1].toUpperCase());
    parts.push(formats.join(', '));
  }

  if (typeof maxSize === 'number') {
    parts.push(`up to ${formatFileSize(maxSize)}`);
  }

  return parts.join(' ');
}

export function generateUploadId(): string {
  const cryptoObj = (globalThis as any)?.crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

/**
 * Simulate realistic upload progress
 * Updates the entry's uploadProgress and uploadedBytes
 * Triggers reactivity callback after each step
 */
export async function simulateProgress(
  entry: {
    uploadProgress?: number;
    uploadedBytes?: number;
    totalBytes?: number;
  },
  triggerReactivity: () => void,
): Promise<void> {
  // Simulate realistic upload progress with slower, more visible increments
  const steps = [15, 25, 35, 45, 55, 65, 75, 85, 92, 98];
  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, 400)); // 400ms per step
    entry.uploadProgress = step;
    entry.uploadedBytes = Math.floor((entry.totalBytes! * step) / 100);
    triggerReactivity(); // Trigger reactivity
  }
}

/**
 * Validate an image file against configuration options (synchronous checks only)
 * Returns null if valid, or an error message string if invalid
 * Note: This only validates file type, size, and format.
 * For dimension/aspect ratio validation, use validateImageDimensions after loading.
 */
export function validateImageFile(
  file: File,
  validation?: {
    maxFileSize?: number;
    allowedFormats?: ('image/jpeg' | 'image/png' | 'image/gif')[];
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: string;
  },
): string | null {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    return 'Not an image file';
  }

  // Validate file size
  const maxSize = validation?.maxFileSize || 10 * 1024 * 1024;
  if (file.size > maxSize) {
    const maxMB = Math.round(maxSize / 1024 / 1024);
    return `File too large (max ${maxMB}MB)`;
  }

  // Validate format if specified
  if (validation?.allowedFormats) {
    if (!validation.allowedFormats.includes(file.type as any)) {
      const formats = validation.allowedFormats
        .map((f) => f.split('/')[1].toUpperCase())
        .join(', ');
      return `Format not allowed. Allowed: ${formats}`;
    }
  }

  return null; // Valid
}

/**
 * Validate image dimensions and aspect ratio (async - requires loading the image)
 * Returns null if valid, or an error message string if invalid
 */
export async function validateImageDimensions(
  file: File,
  validation?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: string;
  },
): Promise<string | null> {
  if (!validation) return null;

  const { minWidth, maxWidth, minHeight, maxHeight, aspectRatio } = validation;

  // If no dimension validation is specified, skip loading
  if (!minWidth && !maxWidth && !minHeight && !maxHeight && !aspectRatio) {
    return null;
  }

  try {
    const { width, height } = await loadImageDimensions(file);

    // Validate width
    if (minWidth && width < minWidth) {
      return `Image width too small (min ${minWidth}px, got ${width}px)`;
    }
    if (maxWidth && width > maxWidth) {
      return `Image width too large (max ${maxWidth}px, got ${width}px)`;
    }

    // Validate height
    if (minHeight && height < minHeight) {
      return `Image height too small (min ${minHeight}px, got ${height}px)`;
    }
    if (maxHeight && height > maxHeight) {
      return `Image height too large (max ${maxHeight}px, got ${height}px)`;
    }

    // Validate aspect ratio if specified (e.g., "16/9", "1/1", "4/3")
    if (aspectRatio) {
      const [expectedWidth, expectedHeight] = aspectRatio
        .split('/')
        .map(Number);
      if (expectedWidth && expectedHeight) {
        const expectedRatio = expectedWidth / expectedHeight;
        const actualRatio = width / height;
        const tolerance = 0.02; // 2% tolerance for aspect ratio

        if (Math.abs(actualRatio - expectedRatio) > tolerance) {
          return `Image aspect ratio must be ${aspectRatio} (got ${width}×${height})`;
        }
      }
    }

    return null; // Valid
  } catch (error: any) {
    return `Failed to load image: ${error.message}`;
  }
}
