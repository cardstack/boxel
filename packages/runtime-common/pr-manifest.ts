export type PrManifestStatus = 'open' | 'merged' | 'closed' | 'failed';

export interface PrManifestFile {
  sourceUrl: string;
  path: string;
  name?: string;
  contentType?: string;
  contentHash?: string;
}

export interface PrManifest {
  snapshotId: string;
  listingId?: string;
  listingName?: string;
  createdAt: string;
  files: PrManifestFile[];
  branch: string;
  repo?: string;
  baseBranch?: string;
  locked: boolean;
  pr?: {
    url?: string;
    number?: number;
    status?: PrManifestStatus;
    lastCheckedAt?: string;
    error?: string;
  };
}
