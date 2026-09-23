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
  // `ready` arrives once the worker has loaded QuickJS. It separates the cost
  // of starting the sandbox from the time the submitted script is allowed.
  type: 'ready' | 'success' | 'error';
  result?: RealmRunnerResult;
  error?: string;
}
