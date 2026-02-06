import { Sha256 } from '@aws-crypto/sha256-js';
export class MatrixClient {
    matrixURL;
    username;
    access;
    password;
    seed;
    loginPromise;
    constructor({ matrixURL, username, password, seed, }) {
        if (!password && !seed) {
            throw new Error('Either password or a seed must be specified when creating a matrix client');
        }
        this.matrixURL = matrixURL;
        this.username = username;
        this.password = password;
        this.seed = seed;
    }
    getUserId() {
        return this.access?.userId;
    }
    isLoggedIn() {
        return this.access !== undefined;
    }
    getAccessToken() {
        return this.access?.accessToken;
    }
    async request(path, method = 'GET', options = {}, includeAuth = true) {
        options.method = method;
        if (includeAuth) {
            if (!this.access) {
                throw new Error('Missing matrix access token');
            }
            options.headers = {
                ...options.headers,
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.access.accessToken}`,
            };
        }
        return fetch(`${this.matrixURL.href}${path}`, options);
    }
    async login() {
        if (this.loginPromise) {
            return this.loginPromise;
        }
        this.loginPromise = this.performLogin();
        return this.loginPromise;
    }
    async performLogin() {
        let password;
        if (this.password) {
            password = this.password;
        }
        else if (this.seed) {
            password = await passwordFromSeed(this.username, this.seed);
        }
        else {
            throw new Error('bug: should never be here, we ensure password or seed exists in constructor');
        }
        const response = await this.request('_matrix/client/v3/login', 'POST', {
            body: JSON.stringify({
                identifier: {
                    type: 'm.id.user',
                    user: this.username,
                },
                password,
                type: 'm.login.password',
            }),
        }, false);
        const json = await response.json();
        if (!response.ok) {
            throw new Error(`Unable to login to matrix ${this.matrixURL.href} as user ${this.username}: status ${response.status} - ${JSON.stringify(json)}`);
        }
        const { access_token: accessToken, device_id: deviceId, user_id: userId, } = json;
        this.access = { accessToken, deviceId, userId };
    }
    async getJoinedRooms() {
        const response = await this.request('_matrix/client/v3/joined_rooms');
        return (await response.json());
    }
    async joinRoom(roomId) {
        const response = await this.request(`_matrix/client/v3/rooms/${roomId}/join`, 'POST');
        if (!response.ok) {
            const json = await response.json();
            throw new Error(`Unable to join room ${roomId}: status ${response.status} - ${JSON.stringify(json)}`);
        }
    }
    async getOpenIdToken() {
        if (!this.access) {
            throw new Error('Must be logged in to get OpenID token');
        }
        const response = await this.request(`_matrix/client/v3/user/${encodeURIComponent(this.access.userId)}/openid/request_token`, 'POST', { body: '{}' });
        if (!response.ok) {
            return undefined;
        }
        return response.json();
    }
}
function uint8ArrayToHex(uint8) {
    return Array.from(uint8)
        .map((i) => i.toString(16).padStart(2, '0'))
        .join('');
}
function getMatrixUsername(userId) {
    return userId.replace(/^@/, '').replace(/:.*$/, '');
}
export async function passwordFromSeed(username, seed) {
    const hash = new Sha256();
    const cleanUsername = getMatrixUsername(username);
    hash.update(cleanUsername);
    hash.update(seed);
    return uint8ArrayToHex(await hash.digest());
}
//# sourceMappingURL=matrix-client.js.map