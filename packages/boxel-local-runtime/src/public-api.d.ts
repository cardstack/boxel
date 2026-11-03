export type * from './contracts.ts';
import type {
  ConfiguredBoxelOptions,
  ManagedEnvironmentsOptions,
  LocalBoxelOptions,
  NativeRuntimeHandle,
} from './contracts.ts';
export declare function startLocalBoxel(
  options: LocalBoxelOptions,
): Promise<NativeRuntimeHandle>;

export declare function startConfiguredBoxel(
  options: ConfiguredBoxelOptions,
): Promise<NativeRuntimeHandle | null>;
export declare function prepareBundledBoxelProfile(options: {
  assetDirectory: string;
  dataDirectory: string;
  previousAssetDirectories?: readonly string[];
}): Promise<string>;

export declare function startManagedEnvironments(
  options: ManagedEnvironmentsOptions,
): Promise<{ url: string; stop(): Promise<void> }>;
