export interface RealmRunnerFile {
  url: string;
  content: string;
}

export interface RealmRunnerOperation {
  type: 'replace' | 'create';
  url: string;
  search?: string;
  replacement?: string;
  content?: string;
}

export interface RealmRunnerResult {
  operations: RealmRunnerOperation[];
  scriptResult: string;
}

export interface RealmRunnerRequest {
  type: 'run';
  code: string;
  files: RealmRunnerFile[];
  timeoutMs: number;
}

export interface RealmRunnerResponse {
  type: 'success' | 'error';
  result?: RealmRunnerResult;
  error?: string;
}
