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

import {afterEach, describe, expect, test, vi} from 'vitest';
import {HimotokiClient} from '../ext/js/comm/himotoki-client.js';
import {createEmptySavedBlob, encodeFirestoreFields} from '../ext/js/data/himotoki-saved-blob.js';

/** @returns {{promise: Promise<Response>, resolve: (response: Response) => void}} */
function pendingResponse() {
    /** @type {(response: Response) => void} */
    let resolve = () => {};
    /** @type {Promise<Response>} */
    const promise = new Promise((resolve2) => { resolve = resolve2; });
    return {promise, resolve};
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Response}
 */
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

/**
 * @param {number[]} [sequences]
 * @returns {Response}
 */
function savedResponse(sequences = []) {
    const blob = createEmptySavedBlob(100);
    blob.favorites = sequences.map((seq) => ({source: 'jitendex', seq, headword: '語', reading: '', gloss: '', folderIds: [], savedAt: 100}));
    return jsonResponse({fields: encodeFirestoreFields(blob), updateTime: '2026-09-01T00:00:00Z'});
}

/**
 * @param {boolean} [expired]
 * @returns {{client: HimotokiClient, fetchMock: import('vitest').Mock<(url: string, init?: RequestInit) => Promise<Response>>, getSession: () => ?import('himotoki').Session, runtime: {lastError?: {message: string}}, storageGet: import('vitest').Mock<(keys: string[], callback: (items: {himotokiSession?: ?import('himotoki').Session}) => void) => void>}}
 */
function setup(expired = false) {
    /** @type {?import('himotoki').Session} */
    let session = {uid: 'account-a', email: 'a@example.com', displayName: 'A', idToken: 'old-token', refreshToken: 'refresh-token', expiresAt: expired ? 0 : Date.now() + 3600_000};
    /** @type {import('vitest').Mock<(keys: string[], callback: (items: {himotokiSession?: ?import('himotoki').Session}) => void) => void>} */
    const storageGet = vi.fn((_keys, callback) => callback({himotokiSession: session}));
    /** @type {{lastError?: {message: string}}} */
    const runtime = {};
    vi.stubGlobal('chrome', {
        runtime,
        identity: {
            getRedirectURL: () => 'https://extension.chromiumapp.org/',
            /**
             * @param {{url: string, interactive: boolean}} _details
             * @param {(url: string) => void} callback
             * @returns {void}
             */
            launchWebAuthFlow: (_details, callback) => callback('https://extension.chromiumapp.org/#id_token=google-token'),
        },
        storage: {local: {
            get: storageGet,
            set: vi.fn(
                /**
                 * @param {{himotokiSession: import('himotoki').Session}} items
                 * @param {() => void} callback
                 */
                (items, callback) => { session = items.himotokiSession; callback(); },
            ),
            remove: vi.fn((_key, callback) => { session = null; callback(); }),
        }},
    });
    /** @type {import('vitest').Mock<(url: string, init?: RequestInit) => Promise<Response>>} */
    const fetchMock = vi.fn(async () => savedResponse());
    vi.stubGlobal('fetch', fetchMock);
    return {client: new HimotokiClient(), fetchMock, getSession: () => session, runtime, storageGet};
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Himotoki client', () => {
    test('shares a cold saved-library read across 20 concurrent callers', async () => {
        const {client, fetchMock} = setup();
        const responses = await Promise.all(Array.from({length: 20}, () => client.getSaved(false)));
        expect(responses).toHaveLength(20);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await client.getSaved(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await client.getSaved(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('shares a token refresh across concurrent callers', async () => {
        const {client, fetchMock} = setup(true);
        fetchMock.mockImplementation(async (url) => (url.includes('securetoken') ?
            jsonResponse({id_token: 'new-token', refresh_token: 'new-refresh', expires_in: '3600'}) :
            savedResponse()));
        await Promise.all(Array.from({length: 20}, (_, i) => (i % 2 === 0 ? client.getSaved(false) : client.addFavorite({seq: i, headword: '語'}))));
        expect(fetchMock.mock.calls.filter(([url]) => url.includes('securetoken'))).toHaveLength(1);
    });

    test('a late token refresh cannot undo sign-out', async () => {
        const {client, fetchMock, getSession} = setup(true);
        const refresh = pendingResponse();
        fetchMock.mockReturnValueOnce(refresh.promise);
        const read = client.getSaved(false);
        const rejected = expect(read).rejects.toThrow(/session changed/i);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await client.signOut();
        refresh.resolve(jsonResponse({id_token: 'new-token', refresh_token: 'new-refresh', expires_in: '3600'}));
        await rejected;
        expect((await client.getStatus()).signedIn).toBe(false);
        expect(getSession()).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('rate limiting during token refresh keeps the session available for retry', async () => {
        const {client, fetchMock, getSession} = setup(true);
        fetchMock.mockResolvedValueOnce(jsonResponse({error: {message: 'Too many requests'}}, 429));
        await expect(client.getSaved(false)).rejects.toThrow('Too many requests');
        expect(getSession()).not.toBeNull();
        fetchMock.mockResolvedValueOnce(jsonResponse({id_token: 'new-token', refresh_token: 'new-refresh', expires_in: '3600'}));
        await expect(client.getSaved(false)).resolves.toStrictEqual({favoriteKeys: [], folders: []});
    });

    test.each(['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED : The user account has been disabled by an administrator.'])('clears invalid sessions on %s', async (message) => {
        const {client, fetchMock, getSession} = setup(true);
        fetchMock.mockResolvedValueOnce(jsonResponse({error: {message}}, 400));
        await expect(client.getSaved(false)).rejects.toThrow(/sign-in expired/i);
        expect(getSession()).toBeNull();
        expect((await client.getStatus()).signedIn).toBe(false);
    });

    test('configuration errors do not delete a valid refresh token', async () => {
        const {client, fetchMock, getSession} = setup(true);
        fetchMock.mockResolvedValueOnce(jsonResponse({error: {message: 'PROJECT_NUMBER_MISMATCH'}}, 400));
        await expect(client.getSaved(false)).rejects.toThrow('PROJECT_NUMBER_MISMATCH');
        expect(getSession()).not.toBeNull();
    });

    test('a late library read is discarded after sign-out', async () => {
        const {client, fetchMock} = setup();
        const response = pendingResponse();
        fetchMock.mockReturnValueOnce(response.promise);
        const read = client.getSaved(false);
        const rejected = expect(read).rejects.toThrow(/session changed/i);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await client.signOut();
        response.resolve(savedResponse([1]));
        await rejected;
        expect(await client.getSaved(false)).toStrictEqual({favoriteKeys: [], folders: []});
    });

    test('a save does not write after the account changes during its read', async () => {
        const {client, fetchMock} = setup();
        const response = pendingResponse();
        fetchMock.mockReturnValueOnce(response.promise);
        const save = client.addFavorite({seq: 2, headword: '新'});
        const rejected = expect(save).rejects.toThrow(/session changed/i);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await client.signOut();
        response.resolve(savedResponse([1]));
        await rejected;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('signing into another account discards reads started during the account picker', async () => {
        const {client, fetchMock} = setup();
        const login = pendingResponse();
        const library = pendingResponse();
        fetchMock.mockReturnValueOnce(login.promise).mockReturnValueOnce(library.promise);
        const signIn = client.signIn();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const read = client.getSaved(false);
        const rejected = expect(read).rejects.toThrow(/session changed/i);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        login.resolve(jsonResponse({localId: 'account-b', idToken: 'b-token', refreshToken: 'b-refresh', expiresIn: '3600'}));
        await signIn;
        library.resolve(savedResponse([1]));
        await rejected;
        expect(await client.getSaved(false)).toStrictEqual({favoriteKeys: [], folders: []});
        expect(fetchMock.mock.calls[2][0]).toContain('/saved/account-b');
    });

    test('an old refresh failure cannot sign out a newly signed-in account', async () => {
        const {client, fetchMock, getSession} = setup(true);
        const refresh = pendingResponse();
        fetchMock.mockReturnValueOnce(refresh.promise);
        const read = client.getSaved(false);
        const rejected = expect(read).rejects.toThrow(/session changed/i);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        fetchMock.mockResolvedValueOnce(jsonResponse({localId: 'account-b', idToken: 'b-token', refreshToken: 'b-refresh', expiresIn: '3600'}));
        await client.signIn();
        refresh.resolve(jsonResponse({error: {message: 'TOKEN_EXPIRED'}}, 400));
        await rejected;
        expect(getSession()?.uid).toBe('account-b');
        expect((await client.getStatus()).signedIn).toBe(true);
    });

    test('sign-out cancels an unfinished sign-in', async () => {
        const {client, fetchMock, getSession} = setup();
        const login = pendingResponse();
        fetchMock.mockReturnValueOnce(login.promise);
        const signIn = client.signIn();
        const rejected = expect(signIn).rejects.toThrow(/session changed/i);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await client.signOut();
        login.resolve(jsonResponse({localId: 'account-b', idToken: 'b-token', refreshToken: 'b-refresh', expiresIn: '3600'}));
        await rejected;
        expect(getSession()).toBeNull();
    });

    test('retries transient storage read failures', async () => {
        const {client, storageGet, runtime} = setup();
        storageGet.mockImplementationOnce((_keys, callback) => {
            runtime.lastError = {message: 'Storage unavailable'};
            if (typeof callback === 'function') { callback({}); }
            delete runtime.lastError;
        });
        await expect(client.getStatus()).rejects.toThrow('Storage unavailable');
        expect((await client.getStatus()).signedIn).toBe(true);
    });

    test('a slow library read cannot replace the cache of a completed save', async () => {
        const {client, fetchMock} = setup();
        const response = pendingResponse();
        fetchMock.mockReturnValueOnce(response.promise);
        const read = client.getSaved(false);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await client.addFavorite({seq: 2, headword: '新'});
        response.resolve(savedResponse());
        await read;
        expect((await client.getSaved(false)).favoriteKeys).toStrictEqual(['jitendex:2']);
    });

    test('failed library reads can be retried', async () => {
        const {client, fetchMock} = setup();
        fetchMock.mockRejectedValueOnce(new Error('Offline'));
        await expect(client.getSaved(false)).rejects.toThrow('Offline');
        await expect(client.getSaved(false)).resolves.toStrictEqual({favoriteKeys: [], folders: []});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('only updates favorites and updatedAt on an existing document', async () => {
        const {client, fetchMock} = setup();
        await client.addFavorite({seq: 2, headword: '新'});
        const [url, init] = fetchMock.mock.calls[1];
        expect(init?.method).toBe('PATCH');
        expect(new URL(url).searchParams.getAll('updateMask.fieldPaths')).toStrictEqual(['favorites', 'updatedAt']);
        expect(new URL(url).searchParams.get('currentDocument.updateTime')).toBe('2026-09-01T00:00:00Z');
    });

    test('creates a full document when no library exists', async () => {
        const {client, fetchMock} = setup();
        fetchMock.mockResolvedValueOnce(jsonResponse({error: {message: 'Missing'}}, 404));
        await client.addFavorite({seq: 2, headword: '新'});
        const [url, init] = fetchMock.mock.calls[1];
        expect(new URL(url).searchParams.get('currentDocument.exists')).toBe('false');
        expect(new URL(url).searchParams.getAll('updateMask.fieldPaths')).toStrictEqual([]);
        expect(init?.body).toContain('"version"');
    });

    test('retries a conflicting save with the latest document', async () => {
        const {client, fetchMock} = setup();
        fetchMock.mockResolvedValueOnce(savedResponse())
            .mockResolvedValueOnce(jsonResponse({error: {status: 'FAILED_PRECONDITION'}}, 400))
            .mockResolvedValueOnce(savedResponse([1]))
            .mockResolvedValueOnce(savedResponse([2, 1]));
        await expect(client.addFavorite({seq: 2, headword: '新'})).resolves.toStrictEqual({added: true});
        expect((await client.getSaved(false)).favoriteKeys).toStrictEqual(['jitendex:2', 'jitendex:1']);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    test('a stalled request times out instead of hanging, and a forced refresh does not wait for it (#6)', async () => {
        vi.useFakeTimers();
        try {
            const {client, fetchMock} = setup();
            /** @type {(AbortSignal|null|undefined)[]} */
            const signals = [];
            fetchMock.mockImplementationOnce((_url, init) => {
                signals.push(init?.signal);
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
                });
            });
            const stalled = client.getSaved(false);
            const timedOut = expect(stalled).rejects.toThrow(/did not respond/i);
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect(signals[0]).toBeInstanceOf(AbortSignal);

            // A forced refresh starts its own read rather than sharing the stalled one.
            await expect(client.getSaved(true)).resolves.toStrictEqual({favoriteKeys: [], folders: []});
            expect(fetchMock).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(20_000);
            await timedOut;
        } finally {
            vi.useRealTimers();
        }
    });

    test('a token the server refuses is refreshed once and the request retried (#12)', async () => {
        const {client, fetchMock, getSession} = setup();
        fetchMock.mockResolvedValueOnce(jsonResponse({error: {status: 'UNAUTHENTICATED', message: 'TOKEN_EXPIRED'}}, 401))
            .mockResolvedValueOnce(jsonResponse({id_token: 'new-token', refresh_token: 'new-refresh', expires_in: '3600'}))
            .mockResolvedValueOnce(savedResponse([1]));
        await expect(client.getSaved(true)).resolves.toStrictEqual({favoriteKeys: ['jitendex:1'], folders: []});
        const urls = fetchMock.mock.calls.map(([url]) => new URL(url).hostname);
        expect(urls).toStrictEqual(['firestore.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com']);
        const retry = /** @type {RequestInit} */ (fetchMock.mock.calls[2][1]);
        expect(/** @type {Record<string, string>} */ (retry.headers).Authorization).toBe('Bearer new-token');
        expect(getSession()?.idToken).toBe('new-token');
    });

    test('a token refused again after the refresh is reported, without looping (#12)', async () => {
        const {client, fetchMock} = setup();
        const unauthenticated = () => jsonResponse({error: {status: 'UNAUTHENTICATED', message: 'Unauthenticated'}}, 401);
        fetchMock.mockResolvedValueOnce(unauthenticated())
            .mockResolvedValueOnce(jsonResponse({id_token: 'new-token', refresh_token: 'new-refresh', expires_in: '3600'}))
            .mockResolvedValueOnce(unauthenticated());
        await expect(client.getSaved(true)).rejects.toThrow(/did not accept your sign-in/i);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('a sign-out storage refuses keeps the account signed in here and after a restart (#13)', async () => {
        const {client, runtime} = setup();
        const storage = /** @type {{local: {remove: import('vitest').Mock}}} */ (/** @type {{storage: unknown}} */ (globalThis.chrome).storage);
        storage.local.remove.mockImplementationOnce((_key, callback) => {
            runtime.lastError = {message: 'storage write failed'};
            callback();
            delete runtime.lastError;
        });
        await expect(client.signOut()).rejects.toThrow('storage write failed');
        expect((await client.getStatus()).signedIn).toBe(true);
        expect((await new HimotokiClient().getStatus()).signedIn).toBe(true);
    });
});
