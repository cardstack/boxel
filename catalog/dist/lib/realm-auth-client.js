const MAX_ATTEMPTS = 3;
const BACK_OFF_MS = 1000;
export class RealmAuthClient {
    realmURL;
    matrixClient;
    _jwt;
    constructor(realmURL, matrixClient) {
        this.realmURL = realmURL;
        this.matrixClient = matrixClient;
    }
    get jwt() {
        return this._jwt;
    }
    async getJWT() {
        const tokenRefreshLeadTimeSeconds = 60;
        if (!this._jwt) {
            this._jwt = await this.createRealmSession();
            return this._jwt;
        }
        // Check if token is about to expire
        const jwtData = JSON.parse(atob(this._jwt.split('.')[1]));
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (jwtData.exp - tokenRefreshLeadTimeSeconds < nowSeconds) {
            this._jwt = await this.createRealmSession();
            return this._jwt;
        }
        return this._jwt;
    }
    async createRealmSession() {
        if (!this.matrixClient.isLoggedIn()) {
            throw new Error('Must be logged in to matrix before a realm session can be created');
        }
        const initialResponse = await this.initiateSessionRequest();
        const jwt = initialResponse.headers.get('Authorization');
        if (!jwt) {
            throw new Error("Expected 'Authorization' header in response to POST session but it was missing");
        }
        // Parse JWT to get session room
        const [, payload] = jwt.split('.');
        const jwtBody = JSON.parse(atob(payload));
        const { sessionRoom } = jwtBody;
        if (sessionRoom) {
            const { joined_rooms: rooms } = await this.matrixClient.getJoinedRooms();
            if (!rooms.includes(sessionRoom)) {
                await this.matrixClient.joinRoom(sessionRoom);
            }
        }
        return jwt;
    }
    async initiateSessionRequest() {
        const userId = this.matrixClient.getUserId();
        if (!userId) {
            throw new Error('userId is undefined');
        }
        const openAccessToken = await this.matrixClient.getOpenIdToken();
        if (!openAccessToken) {
            throw new Error('Failed to fetch OpenID token from matrix');
        }
        return this.withRetries(() => fetch(`${this.realmURL.href}_session`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
            },
            body: JSON.stringify(openAccessToken),
        }));
    }
    async withRetries(fetchFn) {
        let attempt = 0;
        for (;;) {
            const response = await fetchFn();
            // Retry on 500 errors (realm may be temporarily unable to authenticate)
            if (response.status === 500 && ++attempt <= MAX_ATTEMPTS) {
                await this.delay(attempt * BACK_OFF_MS);
            }
            else {
                return response;
            }
        }
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=realm-auth-client.js.map