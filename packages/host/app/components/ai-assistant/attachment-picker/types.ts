import type { FileDef } from 'https://cardstack.com/base/file-api';

export interface DraftFileUpload {
  id: string;
  file: FileDef;
  state: 'uploading' | 'error';
  error?: string;
}
