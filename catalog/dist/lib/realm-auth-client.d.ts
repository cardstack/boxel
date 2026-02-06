import type { MatrixClient } from './matrix-client.js';
export interface JWTPayload {
    iat: number;
    exp: number;
    user: string;
    realm: string;
    permissions: string[];
}
export declare class RealmAuthClient {
    private realmURL;
    private matrixClient;
    private _jwt;
    constructor(realmURL: URL, matrixClient: MatrixClient);
    get jwt(): string | undefined;
    getJWT(): Promise<string>;
    private createRealmSession;
    private initiateSessionRequest;
    private withRetries;
    private delay;
}
//# sourceMappingURL=realm-auth-client.d.ts.map