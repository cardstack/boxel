export interface StoredProfileSummary {
  id: string;
  displayName: string;
  matrixUserId: string | null;
  canSignIn: boolean;
  matrixUrl: string;
  realmServerUrl: string;
  hostUrl: string;
  active: boolean;
}
export interface StoredProfileBrowserLogin {
  url: string;
  expiresAt: number | null;
}
export declare function listStoredProfiles(): StoredProfileSummary[];
export declare function createStoredProfileBrowserLogin(
  profileId: string,
): Promise<StoredProfileBrowserLogin>;
export interface ProfileSignInTarget {
  id: string;
  name: string;
  matrixUrl: string;
  realmServerUrl: string;
  hostUrl: string;
}
export interface ProfileSignInView {
  id: string;
  targetId: string;
  state: 'waiting' | 'confirming' | 'saved' | 'failed' | 'cancelled';
  account: { userId: string; displayName: string } | null;
  message: string | null;
}
export interface DesktopProfilesService {
  list(): StoredProfileSummary[];
  targets(): ProfileSignInTarget[];
  currentSignIn(): ProfileSignInView | null;
  browserLogin(profileId: string): Promise<StoredProfileBrowserLogin>;
  remove(profileId: string): Promise<StoredProfileSummary[]>;
  select(profileId: string): StoredProfileSummary[];
  start(targetId: string, browserId: string): ProfileSignInView;
  status(id: string): ProfileSignInView;
  save(id: string): Promise<ProfileSignInView>;
  cancel(id: string): ProfileSignInView;
  dispose(): void;
}
export declare function createDesktopProfilesService(options: {
  openBrowser(url: string, browserId: string): Promise<boolean>;
  onActivityChanged(active: boolean): void;
}): DesktopProfilesService;
