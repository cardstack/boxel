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
  webhook?: {
    id: string;              // UUID from incoming_webhooks table
    path: string;            // webhook_path (e.g., "whk_abc123...")
    signingSecret: string;   // For GitHub webhook configuration
  };
}
