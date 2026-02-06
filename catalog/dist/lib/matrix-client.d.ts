export interface MatrixAccess {
    accessToken: string;
    deviceId: string;
    userId: string;
}
export declare class MatrixClient {
    readonly matrixURL: URL;
    readonly username: string;
    private access;
    private password?;
    private seed?;
    private loginPromise;
    constructor({ matrixURL, username, password, seed, }: {
        matrixURL: URL;
        username: string;
        password?: string;
        seed?: string;
    });
    getUserId(): string | undefined;
    isLoggedIn(): boolean;
    getAccessToken(): string | undefined;
    private request;
    login(): Promise<void>;
    private performLogin;
    getJoinedRooms(): Promise<{
        joined_rooms: string[];
    }>;
    joinRoom(roomId: string): Promise<void>;
    getOpenIdToken(): Promise<{
        access_token: string;
        expires_in: number;
        matrix_server_name: string;
        token_type: string;
    } | undefined>;
}
export declare function passwordFromSeed(username: string, seed: string): Promise<string>;
//# sourceMappingURL=matrix-client.d.ts.map