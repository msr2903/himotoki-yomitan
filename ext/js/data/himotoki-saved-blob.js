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

/**
 * Pure helpers for Himotoki's `saved/{uid}` Firestore document.
 * The merge rules follow `upsertFavorite` in Himotoki's `@msr2903/sync` package so that
 * words saved here converge with words saved on the website.
 */

/** Himotoki's Firestore rules reject documents with more favorites than this. */
export const MAX_FAVORITES = 500;

/**
 * @param {string|undefined} source
 * @param {string|number} seq
 * @returns {string}
 */
export function favoriteKey(source, seq) {
    return `${source || 'jitendex'}:${seq}`;
}

/**
 * @param {number} now
 * @returns {import('himotoki').SavedBlob}
 */
export function createEmptySavedBlob(now) {
    return {
        version: 1,
        folders: [],
        favorites: [],
        likes: [],
        lastFolderId: '',
        updatedAt: now,
    };
}

/**
 * Coerces a decoded document into the blob shape, keeping unrecognized list entries untouched
 * so that a save never drops data written by a newer client.
 * @param {unknown} raw
 * @param {number} now
 * @returns {import('himotoki').SavedBlob}
 */
export function toSavedBlob(raw, now) {
    const blob = createEmptySavedBlob(now);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return blob; }
    const {folders, favorites, likes, lastFolderId, updatedAt} = /** @type {Record<string, unknown>} */ (raw);
    const folderList = asArray(folders);
    const favoriteList = asArray(favorites);
    const likeList = asArray(likes);
    if (folderList !== null) { blob.folders = /** @type {import('himotoki').Folder[]} */ (folderList); }
    if (favoriteList !== null) { blob.favorites = /** @type {import('himotoki').Favorite[]} */ (favoriteList); }
    if (likeList !== null) { blob.likes = likeList; }
    if (typeof lastFolderId === 'string') { blob.lastFolderId = lastFolderId; }
    if (typeof updatedAt === 'number') { blob.updatedAt = updatedAt; }
    return blob;
}

/**
 * @param {unknown} value
 * @returns {?unknown[]}
 */
function asArray(value) {
    return Array.isArray(value) ? /** @type {unknown[]} */ (value) : null;
}

/**
 * Adds a favorite, or merges it into an existing one with the same `source:seq`.
 * Existing favorites keep their `savedAt` and folder membership; provided non-empty fields win.
 * @param {import('himotoki').SavedBlob} blob
 * @param {import('himotoki').FavoriteInput} input
 * @param {number} now
 * @returns {import('himotoki').UpsertResult}
 * @throws {Error} When the favorite is new and the library is full.
 */
export function upsertFavorite(blob, input, now) {
    const knownFolderIds = new Set(blob.folders.map(({id}) => id));
    const folderIds = (input.folderIds ?? []).filter((id) => knownFolderIds.has(id));

    /** @type {Partial<import('himotoki').Favorite>} */
    const meta = {};
    if (input.contextSentence) { meta.contextSentence = input.contextSentence.slice(0, 1000); }
    if (input.sourceUrl) { meta.sourceUrl = input.sourceUrl; }
    if (input.videoTitle) { meta.videoTitle = input.videoTitle; }
    if (typeof input.timestampMs === 'number') { meta.timestampMs = input.timestampMs; }

    const source = input.source || 'jitendex';
    const key = favoriteKey(source, input.seq);
    const index = blob.favorites.findIndex((favorite) => favoriteKey(favorite.source, favorite.seq) === key);

    /** @type {import('himotoki').Favorite[]} */
    let favorites;
    if (index >= 0) {
        const existing = blob.favorites[index];
        favorites = [...blob.favorites];
        favorites[index] = {
            ...existing,
            ...meta,
            headword: input.headword || existing.headword,
            reading: input.reading || existing.reading,
            gloss: input.gloss || existing.gloss,
            pitch: input.pitch || existing.pitch,
            folderIds: [...new Set([...(existing.folderIds ?? []), ...folderIds])],
        };
    } else {
        if (blob.favorites.length >= MAX_FAVORITES) {
            throw new Error(`Your Himotoki library is full (${MAX_FAVORITES} saved words). Remove some words on Himotoki to save more.`);
        }
        favorites = [
            {
                source,
                seq: input.seq,
                headword: input.headword,
                reading: input.reading || '',
                gloss: input.gloss || '',
                pitch: input.pitch || '',
                folderIds,
                savedAt: now,
                ...meta,
            },
            ...blob.favorites,
        ];
    }

    return {
        blob: {...blob, version: 1, favorites, updatedAt: Math.max(now, blob.updatedAt)},
        added: index < 0,
    };
}

/**
 * @param {unknown} value
 * @returns {import('himotoki').FirestoreValue}
 */
export function encodeFirestoreValue(value) {
    switch (typeof value) {
        case 'boolean':
            return {booleanValue: value};
        case 'number':
            return Number.isInteger(value) ? {integerValue: `${value}`} : {doubleValue: value};
        case 'string':
            return {stringValue: value};
        case 'object':
            if (value === null) { return {nullValue: null}; }
            if (Array.isArray(value)) {
                return {arrayValue: {values: value.map((item) => encodeFirestoreValue(item))}};
            }
            return {mapValue: {fields: encodeFirestoreFields(/** @type {Record<string, unknown>} */ (value))}};
        default:
            return {nullValue: null};
    }
}

/**
 * Properties whose value is `undefined` are omitted, like Firestore's `ignoreUndefinedProperties`.
 * @param {Record<string, unknown>} object
 * @returns {import('himotoki').FirestoreFields}
 */
export function encodeFirestoreFields(object) {
    /** @type {import('himotoki').FirestoreFields} */
    const fields = {};
    for (const [key, value] of Object.entries(object)) {
        if (typeof value === 'undefined') { continue; }
        fields[key] = encodeFirestoreValue(value);
    }
    return fields;
}

/**
 * @param {import('himotoki').FirestoreValue} value
 * @returns {unknown}
 */
export function decodeFirestoreValue(value) {
    if ('booleanValue' in value) { return value.booleanValue; }
    if ('integerValue' in value) { return Number(value.integerValue); }
    if ('doubleValue' in value) { return value.doubleValue; }
    if ('stringValue' in value) { return value.stringValue; }
    if ('timestampValue' in value) { return value.timestampValue; }
    if ('arrayValue' in value) { return (value.arrayValue.values ?? []).map((item) => decodeFirestoreValue(item)); }
    if ('mapValue' in value) { return decodeFirestoreFields(value.mapValue.fields ?? {}); }
    return null;
}

/**
 * @param {import('himotoki').FirestoreFields} fields
 * @returns {Record<string, unknown>}
 */
export function decodeFirestoreFields(fields) {
    /** @type {Record<string, unknown>} */
    const object = {};
    for (const [key, value] of Object.entries(fields)) {
        object[key] = decodeFirestoreValue(value);
    }
    return object;
}
