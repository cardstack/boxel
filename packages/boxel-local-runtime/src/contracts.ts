export interface NativeSecretEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer | Promise<Buffer>;
  decryptString(value: Buffer): string | Promise<string>;
}
export interface NativeService {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  envFrom: Record<string, string>;
  dependsOn: string[];
  readiness:
    | { kind: 'http'; url: string; timeoutMs: number; intervalMs: number }
    | { kind: 'process'; graceMs: number }
    | {
        kind: 'tcp';
        host: string;
        port: number;
        timeoutMs: number;
        intervalMs: number;
      };
  stopSignal: 'SIGTERM' | 'SIGINT';
  stopTimeoutMs: number;
}
export interface LocalRuntimePlan {
  initialStack: string;
  controlPort: number;
  dataDirectory: string;
  manifest: {
    schemaVersion: 1;
    stacks: {
      default: { mode: 'local'; url: string; services: NativeService[] };
    };
    gateway: { port: number; routes: Record<string, { target: string }> };
  };
  environment: Record<string, string>;
  prepareService(stack: string, service: string): Promise<void>;
  createBrowserLoginToken(request: {
    userId: string;
    accessToken: string;
  }): Promise<{ loginToken: string; expiresInMs: number }>;
}
export interface NativeRuntimeHandle {
  stop(): Promise<void>;
}
export interface NativeRuntimeHost {
  start(plan: LocalRuntimePlan): Promise<NativeRuntimeHandle>;
}
export interface LocalBoxelOptions {
  profileFile: string;
  electronPath: string;
  encryption: NativeSecretEncryption;
  host: NativeRuntimeHost;
}

export interface ConfiguredBoxelOptions {
  userDataDirectory: string;
  electronPath: string;
  environment: Record<string, string | undefined>;
  encryption: NativeSecretEncryption;
  host: NativeRuntimeHost;
}

export interface NativeModelsConfiguration {
  provider: 'boxel' | 'local';
  environment: 'production' | 'staging';
  localUserId: string;
  profileId: string | null;
}
export interface NativeModelsView {
  schemaVersion: 1;
  provider: 'boxel' | 'local';
  environment: 'production' | 'staging';
  billingProfiles: {
    production: Record<string, string>;
    staging: Record<string, string>;
  };
  billing: 'boxel-credits' | 'local';
  accounts: {
    id: string;
    displayName: string;
    matrixUserId: string;
    environment: 'production' | 'staging';
  }[];
  localUsers: { id: string; name: string }[];
  restartRequired: boolean;
}

export interface NativeEnvironmentJob {
  id: string;
  action: 'prepare' | 'test' | 'build' | 'run' | 'stop';
  state: 'running' | 'passed' | 'failed' | 'cancelled';
  phase: string;
  startedAt: string;
  finishedAt: string | null;
}
export interface NativeManagedEnvironment {
  id: string;
  name: string;
  branch: string;
  path: string;
  namespace: string;
  gatewayPort: number;
  controlPort: number;
  modelsPort: number;
  url: string;
  state: 'preparing' | 'ready' | 'running' | 'error';
  error: string | null;
  createdAt: string;
  job: NativeEnvironmentJob | null;
  builtHash: string | null;
  testedHash: string | null;
  profileId: string | null;
}
export interface NativeEnvironmentCreate {
  name: string;
  source:
    | { kind: 'official' }
    | { kind: 'checkout'; path: string; ref: string };
}
export interface ManagedEnvironmentsOptions {
  directory: string;
  bundledDirectory: string;
  electronPath: string;
  encryption: NativeSecretEncryption;
  host: NativeRuntimeHost;
  port?: number;
}
