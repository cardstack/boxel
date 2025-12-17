export type UploadStatus = 'idle' | 'pending' | 'success' | 'error';

export interface UploadEntry {
  id: string;
  file: File;
  preview: string;
  url?: string;
  selected?: boolean;
  readProgress?: number;
  isReading?: boolean;
  isUploading?: boolean;
  uploadStatus?: UploadStatus;
  uploadError?: string;
}
