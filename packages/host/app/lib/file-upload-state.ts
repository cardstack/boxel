export type FileUploadStatus = 'uploading' | 'complete' | 'error';

export interface FileUploadState {
  status: FileUploadStatus;
  error?: string;
}
