// Hand-written types for the vendored bundle in this directory, so a host or
// catalog card that imports QrCode type-checks. Only `create`, the one export.

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrCreateOptions {
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  version?: number;
  maskPattern?: number;
}

export interface QrBitMatrix {
  size: number;
  /** 1 for a dark module, 0 for a light one */
  get(row: number, col: number): number;
}

export interface QrCodeSymbol {
  modules: QrBitMatrix;
  version: number;
  errorCorrectionLevel: unknown;
  maskPattern: number;
  segments: unknown[];
}

/** Throws on empty input and on data too long for any version. */
export declare function create(
  data: string,
  options?: QrCreateOptions,
): QrCodeSymbol;
