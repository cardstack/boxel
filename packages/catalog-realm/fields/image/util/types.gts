/**
 * Core upload variants - different fundamental use cases
 */
export type UploadVariant = 'single' | 'multiple' | 'avatar' | 'gallery';

/**
 * Feature flags that can enhance any core variant
 */
export interface UploadFeatures {
  dragDrop?: boolean; // Enable drag & drop interface
  validated?: boolean; // Enable strict validation with real-time feedback
  progress?: boolean; // Show upload progress bar
  camera?: boolean; // Enable camera capture (mobile-optimized)
}

/**
 * Base configuration for all image upload variants
 */
export interface BaseUploadConfig {
  type: UploadVariant; // Required core variant
  maxSize?: number; // Maximum file size in bytes
  allowedFormats?: string[]; // Allowed file formats
  showPreview?: boolean; // Show image previews
  features?: UploadFeatures; // Feature flags to enhance the variant
}

/**
 * Single upload configuration - one image at a time, replaces on new upload
 */
export interface SingleUploadConfig extends BaseUploadConfig {
  type: 'single';
  placeholder?: string; // Placeholder text
}

/**
 * Multiple upload configuration - multiple file selection, accumulative
 */
export interface MultipleUploadConfig extends BaseUploadConfig {
  type: 'multiple';
  maxFiles?: number; // Maximum number of files
  scrollable?: boolean; // Whether grid should scroll horizontally (true) or stack vertically (false)
  showFileName?: boolean; // Show uploaded file names
  showFileSize?: boolean; // Show uploaded file sizes
  placeholder?: string; // Optional placeholder text for nested single uploads
}

/**
 * Avatar upload configuration - circular preview optimized for profiles
 */
export interface AvatarUploadConfig extends BaseUploadConfig {
  type: 'avatar';
  circular?: boolean; // Force circular preview (default: true)
  size?: number; // Avatar size in pixels (default: 128)
}

/**
 * Gallery upload configuration - grid display with uniform aspect ratio
 */
export interface GalleryUploadConfig extends BaseUploadConfig {
  type: 'gallery';
  gridColumns?: number; // Number of columns in gallery grid
  aspectRatio?: string; // Uniform aspect ratio (e.g., '16/9', '1/1', '4/3')
  gap?: string; // Spacing between images
}

/**
 * Image validation configuration for validated feature
 */
export interface ImageValidationConfig {
  minWidth?: number; // Minimum width in pixels
  maxWidth?: number; // Maximum width in pixels
  minHeight?: number; // Minimum height in pixels
  maxHeight?: number; // Maximum height in pixels
  exactRatio?: string; // Exact aspect ratio requirement (e.g., '16/9')
}

/**
 * Upload progress configuration for progress feature
 */
export interface UploadProgressConfig {
  showPercentage?: boolean; // Show percentage (default: true)
  showSizeInfo?: boolean; // Show uploaded/total size (default: true)
  color?: string; // Progress bar color
}

/**
 * Camera capture configuration for camera feature
 */
export interface CameraConfig {
  facingMode?: 'user' | 'environment'; // Front or back camera
  quality?: number; // Image quality 0-1
  maxWidth?: number; // Max capture width
  maxHeight?: number; // Max capture height
}

/**
 * Complete upload configuration union type
 */
export type UploadConfig =
  | SingleUploadConfig
  | MultipleUploadConfig
  | AvatarUploadConfig
  | GalleryUploadConfig;

export type FieldConfigMap = {
  single: SingleUploadConfig;
  multiple: MultipleUploadConfig;
  avatar: AvatarUploadConfig;
  gallery: GalleryUploadConfig;
};
