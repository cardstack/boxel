// Only adapters create these handles. JSON requests cannot name a disk file.
export class StagedFile {
  readonly stagedPath: string;
  readonly size: number;
  readonly sha256: string;
  readonly contentHash: string;

  constructor(
    stagedPath: string,
    size: number,
    sha256: string,
    contentHash: string,
  ) {
    this.stagedPath = stagedPath;
    this.size = size;
    this.sha256 = sha256;
    this.contentHash = contentHash;
  }
}

export function isStagedFile(content: unknown): content is StagedFile {
  return content instanceof StagedFile;
}
