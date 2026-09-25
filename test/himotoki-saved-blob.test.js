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

import {describe, expect, test} from 'vitest';
import {
    MAX_FAVORITES,
    createEmptySavedBlob,
    decodeFirestoreFields,
    encodeFirestoreFields,
    favoriteKey,
    toSavedBlob,
    upsertFavorite,
} from '../ext/js/data/himotoki-saved-blob.js';

/**
 * @param {Partial<import('himotoki').Favorite>} overrides
 * @returns {import('himotoki').Favorite}
 */
function createFavorite(overrides) {
    return {
        source: 'jitendex',
        seq: 1,
        headword: '語',
        reading: 'ご',
        gloss: 'word',
        pitch: '',
        folderIds: [],
        savedAt: 100,
        ...overrides,
    };
}

describe('Himotoki saved blob', () => {
    test('favoriteKey defaults the source to jitendex', () => {
        expect(favoriteKey(void 0, 5)).toStrictEqual('jitendex:5');
        expect(favoriteKey('yomitan', 'yt_1')).toStrictEqual('yomitan:yt_1');
    });

    test('toSavedBlob fills missing fields', () => {
        expect(toSavedBlob(null, 7)).toStrictEqual(createEmptySavedBlob(7));
        expect(toSavedBlob({favorites: [], lastFolderId: 'f1', updatedAt: 3}, 7)).toStrictEqual({...createEmptySavedBlob(3), lastFolderId: 'f1'});
    });

    test('upsertFavorite prepends a new favorite with mining metadata and known folders only', () => {
        const blob = {
            ...createEmptySavedBlob(50),
            folders: [{id: 'f1', name: 'Mining', createdAt: 1}],
            favorites: [createFavorite({seq: 1})],
        };
        const {blob: result, added} = upsertFavorite(blob, {
            source: 'jitendex',
            seq: 2,
            headword: '寿司',
            reading: 'すし',
            folderIds: ['f1', 'missing'],
            contextSentence: 'x'.repeat(1200),
            sourceUrl: 'https://example.com',
        }, 200);
        expect(added).toBe(true);
        expect(result.updatedAt).toStrictEqual(200);
        expect(result.favorites.map(({seq}) => seq)).toStrictEqual([2, 1]);
        expect(result.favorites[0]).toStrictEqual({
            source: 'jitendex',
            seq: 2,
            headword: '寿司',
            reading: 'すし',
            gloss: '',
            pitch: '',
            folderIds: ['f1'],
            savedAt: 200,
            contextSentence: 'x'.repeat(1000),
            sourceUrl: 'https://example.com',
        });
    });

    test('upsertFavorite merges into an existing favorite without losing data', () => {
        const blob = {
            ...createEmptySavedBlob(50),
            folders: [{id: 'f1', name: 'A', createdAt: 1}, {id: 'f2', name: 'B', createdAt: 2}],
            favorites: [createFavorite({seq: 1, folderIds: ['f1'], contextSentence: 'old sentence', savedAt: 10})],
        };
        const {blob: result, added} = upsertFavorite(blob, {seq: 1, headword: '', gloss: 'new gloss', folderIds: ['f2']}, 200);
        expect(added).toBe(false);
        expect(result.favorites).toStrictEqual([
            createFavorite({seq: 1, gloss: 'new gloss', folderIds: ['f1', 'f2'], contextSentence: 'old sentence', savedAt: 10}),
        ]);
    });

    test('upsertFavorite refuses to add to a full library but can still update', () => {
        const favorites = Array.from({length: MAX_FAVORITES}, (_, i) => createFavorite({seq: i + 1}));
        const blob = {...createEmptySavedBlob(50), favorites};
        expect(() => upsertFavorite(blob, {seq: MAX_FAVORITES + 1, headword: '新'}, 200)).toThrow(/full/);
        expect(upsertFavorite(blob, {seq: 1, headword: '新'}, 200).added).toBe(false);
    });

    test('Firestore encoding round-trips the saved blob', () => {
        const blob = {
            ...createEmptySavedBlob(1700000000000),
            folders: [{id: 'f1', name: 'Mining', createdAt: 1}],
            favorites: [createFavorite({seq: 'yt_abc', timestampMs: 1.5})],
        };
        const fields = encodeFirestoreFields(blob);
        expect(fields.updatedAt).toStrictEqual({integerValue: '1700000000000'});
        expect(fields.likes).toStrictEqual({arrayValue: {values: []}});
        expect(decodeFirestoreFields(fields)).toStrictEqual(blob);
    });

    test('Firestore encoding omits undefined properties', () => {
        expect(encodeFirestoreFields({a: void 0, b: null, c: true})).toStrictEqual({b: {nullValue: null}, c: {booleanValue: true}});
    });
});
