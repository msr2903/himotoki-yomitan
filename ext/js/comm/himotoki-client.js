/*
 * Copyright (C) 2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {readResponseJson} from '../core/json.js';
import {createEmptySavedBlob, decodeFirestoreFields, encodeFirestoreFields, favoriteKey, toSavedBlob, upsertFavorite} from '../data/himotoki-saved-blob.js';

/**
 * Public Firebase web config for the `himotoki` project. These are identifiers, not secrets;
 * access is enforced by Firebase Auth and Himotoki's Firestore security rules.
 */
const FIREBASE_API_KEY = 'AIzaSyBWnRUvmoBqDiskcY6krGgNG87vz8bzcnQ';
const FIREBASE_PROJECT_ID = 'himotoki';

/**
 * Client ID of a "Web application" Google OAuth client in the `himotoki` GCP project.
 * The redirect URL shown in Settings → Himotoki must be added to the client's authorized redirect URIs.
 * Sign-in is unavailable while this is empty.
 */
export const GOOGLE_OAUTH_CLIENT_ID = '';

/** Web address used for the no-sign-in quick-add fallback. */
export const HIMOTOKI_WEB_URL = 'https://himotoki.web.app';

const SESSION_STORAGE_KEY = 'himotokiSession';
/** Refresh the Firebase ID token when it has less than this long left, in milliseconds. */
const TOKEN_REFRESH_MARGIN = 60_000;
/** Maximum age of the cached saved-word list, in milliseconds. */
const SAVED_CACHE_MAX_AGE = 60_000;
/** Attempts for a read-modify-write when another client writes concurrently. */
const MAX_WRITE_ATTEMPTS = 3;

/**
 * Himotoki account access via Google sign-in, Firebase Auth, and the Firestore REST API.
 * Runs in the background context so the session and cache are shared by all popups.
 */
export class HimotokiClient {
    constructor() {
        /** @type {?Promise<?import('himotoki').Session>} */
        this._sessionPromise = null;
        /** @type {?{blob: import('himotoki').SavedBlob, fetchedAt: number}} */
        this._savedCache = null;
    }

    /**
     * @returns {Promise<import('himotoki').Status>}
     */
    async getStatus() {
        const session = await this._getStoredSession();
        const hasIdentity = typeof chrome.identity === 'object' && chrome.identity !== null;
        return {
            signInAvailable: GOOGLE_OAUTH_CLIENT_ID.length > 0 && hasIdentity,
            signedIn: session !== null,
            email: session?.email ?? '',
            displayName: session?.displayName ?? '',
            redirectUrl: hasIdentity ? chrome.identity.getRedirectURL() : '',
        };
    }

    /**
     * Opens Google's account picker and exchanges the result for a Firebase session.
     * @returns {Promise<import('himotoki').Status>}
     */
    async signIn() {
        if (GOOGLE_OAUTH_CLIENT_ID.length === 0) {
            throw new Error('Himotoki sign-in is not configured in this build (missing Google OAuth client ID)');
        }
        const redirectUrl = chrome.identity.getRedirectURL();
        const idToken = await this._getGoogleIdToken(redirectUrl);

        /** @type {import('himotoki').SignInWithIdpResponse} */
        const response = await this._fetchGoogleApi(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    postBody: new URLSearchParams({id_token: idToken, providerId: 'google.com'}).toString(),
                    requestUri: redirectUrl,
                    returnSecureToken: true,
                }),
            },
        );

        await this._setSession({
            uid: response.localId,
            email: response.email ?? '',
            displayName: response.displayName ?? '',
            idToken: response.idToken,
            refreshToken: response.refreshToken,
            expiresAt: Date.now() + (Number(response.expiresIn) * 1000),
        });
        return await this.getStatus();
    }

    /**
     * @returns {Promise<import('himotoki').Status>}
     */
    async signOut() {
        await this._setSession(null);
        return await this.getStatus();
    }

    /**
     * @param {boolean} forceRefresh
     * @returns {Promise<import('himotoki').SavedSummary>}
     */
    async getSaved(forceRefresh) {
        const session = await this._getStoredSession();
        if (session === null) {
            return {favoriteKeys: [], folders: []};
        }
        if (forceRefresh || this._savedCache === null || Date.now() - this._savedCache.fetchedAt > SAVED_CACHE_MAX_AGE) {
            const {blob} = await this._readSavedDocument();
            this._setSavedCache(blob);
        }
        const {blob} = /** @type {{blob: import('himotoki').SavedBlob}} */ (this._savedCache);
        return {
            favoriteKeys: blob.favorites.map(({source, seq}) => favoriteKey(source, seq)),
            folders: blob.folders,
        };
    }

    /**
     * Adds or merges a favorite using an optimistic read-modify-write, retrying when another
     * client (for example the Himotoki website) wrote the document in between.
     * @param {import('himotoki').FavoriteInput} favorite
     * @returns {Promise<import('himotoki').AddFavoriteResult>}
     */
    async addFavorite(favorite) {
        for (let attempt = 1; ; ++attempt) {
            const {blob, updateTime} = await this._readSavedDocument();
            const result = upsertFavorite(blob, favorite, Date.now());
            try {
                await this._writeSavedDocument(result.blob, updateTime);
            } catch (e) {
                if (e instanceof HimotokiConflictError && attempt < MAX_WRITE_ATTEMPTS) { continue; }
                throw e;
            }
            this._setSavedCache(result.blob);
            return {added: result.added};
        }
    }

    // Private

    /**
     * @param {string} redirectUrl
     * @returns {Promise<string>}
     */
    async _getGoogleIdToken(redirectUrl) {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
            client_id: GOOGLE_OAUTH_CLIENT_ID,
            response_type: 'id_token',
            redirect_uri: redirectUrl,
            scope: 'openid email profile',
            nonce: crypto.randomUUID(),
            prompt: 'select_account',
        }).toString();

        /** @type {string|undefined} */
        const responseUrl = await new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow({url: url.toString(), interactive: true}, (result) => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve(result);
                }
            });
        });
        if (typeof responseUrl !== 'string') {
            throw new Error('Google sign-in was cancelled');
        }

        const result = new URLSearchParams(new URL(responseUrl).hash.slice(1));
        const error = result.get('error');
        if (error !== null) {
            throw new Error(`Google sign-in failed: ${error}`);
        }
        const idToken = result.get('id_token');
        if (idToken === null) {
            throw new Error('Google sign-in returned no ID token');
        }
        return idToken;
    }

    /**
     * @returns {Promise<?import('himotoki').Session>}
     */
    _getStoredSession() {
        if (this._sessionPromise === null) {
            this._sessionPromise = (async () => {
                /** @type {unknown} */
                const session = await new Promise((resolve, reject) => {
                    chrome.storage.local.get([SESSION_STORAGE_KEY], (result) => {
                        const e = chrome.runtime.lastError;
                        if (e) {
                            reject(new Error(e.message));
                        } else {
                            resolve(/** @type {unknown} */ (result[SESSION_STORAGE_KEY]));
                        }
                    });
                });
                return isSession(session) ? session : null;
            })();
        }
        return this._sessionPromise;
    }

    /**
     * @param {?import('himotoki').Session} session
     */
    async _setSession(session) {
        this._sessionPromise = Promise.resolve(session);
        this._savedCache = null;
        await new Promise((resolve, reject) => {
            /** */
            const callback = () => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve(void 0);
                }
            };
            if (session === null) {
                chrome.storage.local.remove(SESSION_STORAGE_KEY, callback);
            } else {
                chrome.storage.local.set({[SESSION_STORAGE_KEY]: session}, callback);
            }
        });
    }

    /**
     * Returns a session with an unexpired ID token, refreshing it if needed.
     * Concurrent callers share one refresh request.
     * @returns {Promise<import('himotoki').Session>}
     */
    async _getActiveSession() {
        const session = await this._getStoredSession();
        if (session === null) {
            throw new Error('Not signed in to Himotoki. Sign in under Settings → Himotoki.');
        }
        if (session.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN) {
            return session;
        }

        const refreshPromise = this._refreshSession(session);
        this._sessionPromise = refreshPromise;
        refreshPromise.catch(() => {
            // Reload from storage next time; a rejected refresh token has already been cleared there.
            if (this._sessionPromise === refreshPromise) { this._sessionPromise = null; }
        });
        return await refreshPromise;
    }

    /**
     * @param {import('himotoki').Session} session
     * @returns {Promise<import('himotoki').Session>}
     */
    async _refreshSession(session) {
        /** @type {import('himotoki').RefreshTokenResponse} */
        let response;
        try {
            response = await this._fetchGoogleApi(
                `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: session.refreshToken}).toString(),
                },
            );
        } catch (e) {
            if (e instanceof HimotokiApiError && e.status >= 400 && e.status < 500) {
                await this._setSession(null);
                throw new Error('Your Himotoki sign-in expired. Sign in again under Settings → Himotoki.');
            }
            throw e;
        }
        /** @type {import('himotoki').Session} */
        const nextSession = {
            ...session,
            idToken: response.id_token,
            refreshToken: response.refresh_token,
            expiresAt: Date.now() + (Number(response.expires_in) * 1000),
        };
        await this._setSession(nextSession);
        return nextSession;
    }

    /**
     * @param {string} uid
     * @returns {string}
     */
    _getSavedDocumentUrl(uid) {
        return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/saved/${encodeURIComponent(uid)}`;
    }

    /**
     * @returns {Promise<{blob: import('himotoki').SavedBlob, updateTime: ?string}>}
     */
    async _readSavedDocument() {
        const {uid, idToken} = await this._getActiveSession();
        /** @type {import('himotoki').FirestoreDocument} */
        let document;
        try {
            document = await this._fetchGoogleApi(this._getSavedDocumentUrl(uid), {
                headers: {Authorization: `Bearer ${idToken}`},
            });
        } catch (e) {
            if (e instanceof HimotokiApiError && e.status === 404) {
                return {blob: createEmptySavedBlob(Date.now()), updateTime: null};
            }
            throw e;
        }
        return {
            blob: toSavedBlob(decodeFirestoreFields(document.fields ?? {}), Date.now()),
            updateTime: document.updateTime ?? null,
        };
    }

    /**
     * Replaces the document, failing with {@link HimotokiConflictError} if it changed since `updateTime`
     * (or was created, when `updateTime` is null).
     * @param {import('himotoki').SavedBlob} blob
     * @param {?string} updateTime
     */
    async _writeSavedDocument(blob, updateTime) {
        const {uid, idToken} = await this._getActiveSession();
        const url = new URL(this._getSavedDocumentUrl(uid));
        if (updateTime === null) {
            url.searchParams.set('currentDocument.exists', 'false');
        } else {
            url.searchParams.set('currentDocument.updateTime', updateTime);
        }
        try {
            await this._fetchGoogleApi(url.toString(), {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({fields: encodeFirestoreFields(blob)}),
            });
        } catch (e) {
            if (e instanceof HimotokiApiError) {
                if (e.status === 409 || e.statusText === 'FAILED_PRECONDITION' || e.statusText === 'ALREADY_EXISTS' || e.statusText === 'ABORTED') {
                    throw new HimotokiConflictError(e.message);
                }
                if (e.status === 403) {
                    throw new Error('Himotoki rejected the save. Your library may be full, or your account may not have access.');
                }
            }
            throw e;
        }
    }

    /**
     * @param {import('himotoki').SavedBlob} blob
     */
    _setSavedCache(blob) {
        this._savedCache = {blob, fetchedAt: Date.now()};
    }

    /**
     * @template [T=unknown]
     * @param {string} url
     * @param {RequestInit} init
     * @returns {Promise<T>}
     * @throws {HimotokiApiError}
     */
    async _fetchGoogleApi(url, init) {
        const response = await fetch(url, {...init, cache: 'no-store', credentials: 'omit'});
        /** @type {unknown} */
        let body = null;
        try {
            body = await readResponseJson(response);
        } catch {
            // Handled below.
        }
        if (!response.ok) {
            const {message, status} = getGoogleApiError(/** @type {import('himotoki').GoogleApiErrorResponse} */ (body));
            throw new HimotokiApiError(message || `Himotoki request failed (HTTP ${response.status})`, response.status, status);
        }
        if (body === null) {
            throw new Error(`Himotoki returned an invalid response (HTTP ${response.status})`);
        }
        return /** @type {T} */ (body);
    }
}

class HimotokiApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status HTTP status code.
     * @param {string} statusText Google API status, such as `FAILED_PRECONDITION`.
     */
    constructor(message, status, statusText) {
        super(message);
        /** @type {string} */
        this.name = 'HimotokiApiError';
        /** @type {number} */
        this.status = status;
        /** @type {string} */
        this.statusText = statusText;
    }
}

/** The saved-words document changed between reading and writing it. */
class HimotokiConflictError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        /** @type {string} */
        this.name = 'HimotokiConflictError';
    }
}

/**
 * @param {?import('himotoki').GoogleApiErrorResponse} body
 * @returns {{message: string, status: string}}
 */
function getGoogleApiError(body) {
    const error = body?.error;
    if (typeof error === 'object' && error !== null) {
        return {message: error.message ?? '', status: error.status ?? ''};
    }
    if (typeof error === 'string') {
        return {message: body?.error_description ?? error, status: error};
    }
    return {message: '', status: ''};
}

/**
 * @param {unknown} value
 * @returns {value is import('himotoki').Session}
 */
function isSession(value) {
    if (typeof value !== 'object' || value === null) { return false; }
    const {uid, idToken, refreshToken, expiresAt} = /** @type {Record<string, unknown>} */ (value);
    return (
        typeof uid === 'string' &&
        typeof idToken === 'string' &&
        typeof refreshToken === 'string' &&
        typeof expiresAt === 'number'
    );
}
