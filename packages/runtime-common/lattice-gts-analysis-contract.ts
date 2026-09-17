import type { BxlComputeDefinition } from '@cardstack/bxl';
import type { ClassReference } from './schema-analysis-plugin.ts';

// Consumers of persisted facts must not load the parser or the BXL compiler.
export const LATTICE_GTS_ANALYZER_REVISION = 'lattice-gts-source-v4';

export const LATTICE_GTS_DATA_REVISION_ALGORITHM = 'boxel-gts-data-ast-v1';

export interface LatticeGtsDiagnostic {
  code: string;
  message: string;
  line?: number;
  field?: string;
}

export interface LatticeGtsExportAnalysis {
  name: string;
  localName?: string;
  // An alias addresses a source-local declaration or an external export.
  target?: ClassReference;
  // This is local evidence, never permission to execute code in Node.
  indexing: 'requires-linking' | 'chrome-data' | 'blocked';
  extends?: ClassReference;
  fields: Array<{
    name: string;
    type: ClassReference;
    value: ClassReference;
    decorator: ClassReference;
    bxl?: BxlComputeDefinition;
    query?: unknown;
  }>;
  reasons: LatticeGtsDiagnostic[];
}

export interface LatticeGtsAnalysis {
  version: 1;
  coverage: 'local-syntax';
  analyzerRevision: string;
  fileId: string;
  sourceRevision: { algorithm: 'boxel-content-hash-utf8-v1'; digest: string };
  // Separate from byte freshness. Only a successfully linked and admitted
  // declarative computation may reuse data by this revision. It does not
  // authorize arbitrary JavaScript that could inspect its own templates.
  dataRevision?: {
    algorithm: typeof LATTICE_GTS_DATA_REVISION_ALGORITHM;
    digest: string;
  };
  state: 'analyzed' | 'blocked';
  imports: Array<{
    module: string;
    kind: 'import' | 'reexport';
    typeOnly: boolean;
  }>;
  exports: LatticeGtsExportAnalysis[];
  exportStars: string[];
  // Internal ClassReference.classIndex addresses this source-local table.
  localDefinitions: LatticeGtsExportAnalysis[];
  diagnostics: LatticeGtsDiagnostic[];
}
