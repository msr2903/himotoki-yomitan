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
import {buildHimotokiFavorite, legacyStableSeq, stableSeq} from '../ext/js/data/himotoki-favorite-builder.js';
import {createEmptySavedBlob, favoriteKey, isFavoriteSaved, savedWordKey, upsertFavorite} from '../ext/js/data/himotoki-saved-blob.js';

/** @type {import('anki-templates-internal').Context} */
const context = {
    url: 'https://example.com/article',
    sentence: {text: '今日は寿司を食べた。', offset: 3},
    documentTitle: 'Example',
    query: '寿司',
    fullQuery: '今日は寿司を食べた。',
};

/** @type {import('settings').HimotokiOptions} */
const options = {
    enable: true,
    folderId: 'f_test',
    includeSentence: true,
    includeUrl: true,
};

/**
 * @param {{term: string, reading: string, dictionary: string, sequence: number, entries: import('dictionary-data').TermGlossaryContent[]}} details
 * @returns {import('dictionary').TermDictionaryEntry}
 */
function createTermEntry({term, reading, dictionary, sequence, entries}) {
    return /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        isPrimary: true,
        definitions: [{
            index: 0,
            headwordIndices: [0],
            dictionary,
            dictionaryIndex: 0,
            dictionaryAlias: dictionary,
            id: 1,
            score: 0,
            frequencyOrder: 0,
            sequences: [sequence],
            isPrimary: true,
            tags: [],
            entries,
        }],
        headwords: [{
            index: 0,
            term,
            reading,
            sources: [{
                originalText: term,
                transformedText: term,
                deinflectedText: term,
                matchType: 'exact',
                matchSource: 'term',
                isPrimary: true,
            }],
            tags: [],
            wordClasses: [],
        }],
        pronunciations: [],
        frequencies: [],
        sourceTermExactMatchCount: 1,
        matchPrimaryReading: true,
        maxOriginalTextLength: term.length,
        dictionaryIndex: 0,
        dictionaryAlias: dictionary,
    }));
}

describe('Himotoki favorite builder', () => {
    test('stableSeq is deterministic', () => {
        expect(stableSeq('寿司', 'すし', 'JMdict')).toStrictEqual(stableSeq('寿司', 'すし', 'JMdict'));
        expect(stableSeq('寿司', 'すし', 'JMdict')).not.toStrictEqual(stableSeq('魚', 'さかな', 'JMdict'));
    });

    test('uses the JMdict sequence when present', () => {
        const entry = createTermEntry({term: '寿司', reading: 'すし', dictionary: 'Jitendex', sequence: 1358280, entries: ['sushi', 'vinegared rice']});
        const favorite = buildHimotokiFavorite(entry, context, options);
        expect(favorite).toStrictEqual({
            source: 'jitendex',
            seq: 1358280,
            headword: '寿司',
            reading: 'すし',
            gloss: 'sushi; vinegared rice',
            pitch: '',
            folderIds: ['f_test'],
            contextSentence: '今日は寿司を食べた。',
            sourceUrl: 'https://example.com/article',
            videoTitle: 'Example',
        });
        expect(favoriteKey(favorite.source, favorite.seq)).toStrictEqual('jitendex:1358280');
    });

    test('falls back to a stable yomitan seq and respects mining options', () => {
        const entry = createTermEntry({term: 'テスト', reading: 'てすと', dictionary: 'Custom Dict', sequence: -1, entries: [{type: 'text', text: 'custom gloss'}]});
        const favorite = buildHimotokiFavorite(entry, context, {...options, includeSentence: false, includeUrl: false, folderId: ''});
        expect(favorite.source).toStrictEqual('yomitan');
        expect(String(favorite.seq)).toMatch(/^yt_/);
        expect(favorite.gloss).toStrictEqual('custom gloss');
        expect('contextSentence' in favorite).toBe(false);
        expect('sourceUrl' in favorite).toBe(false);
        expect(favorite.folderIds).toStrictEqual([]);
    });

    test('does not mistake custom dictionary sequences for JMdict IDs', () => {
        const entry = createTermEntry({term: 'テスト', reading: 'てすと', dictionary: 'Custom Dict', sequence: 1358280, entries: ['test']});
        const favorite = buildHimotokiFavorite(entry, context, options);
        expect(favorite.source).toBe('yomitan');
        expect(favorite.seq).toBe(stableSeq('テスト', 'てすと', 'Custom Dict'));
    });

    test('finds a compatible dictionary even after a custom dictionary', () => {
        const entry = createTermEntry({term: '寿司', reading: 'すし', dictionary: 'Custom Dict', sequence: 42, entries: ['sushi']});
        entry.definitions.push({...entry.definitions[0], dictionary: 'JMdict', sequences: [1358280]});
        const favorite = buildHimotokiFavorite(entry, context, options);
        expect(favorite.source).toBe('jmdict');
        expect(favorite.seq).toBe(1358280);
    });

    test('extracts glossary lists from structured content', () => {
        /** @type {import('dictionary-data').TermGlossaryContent} */
        const structuredContent = {
            type: 'structured-content',
            content: [
                {tag: 'span', content: 'noun'},
                {tag: 'ul',
                    data: {content: 'glossary'},
                    content: [
                        {tag: 'li', content: 'sushi'},
                        {tag: 'li', content: 'vinegared rice'},
                    ]},
                {tag: 'div', data: {content: 'example-sentence'}, content: '寿司を食べる'},
            ],
        };
        const entry = createTermEntry({term: '寿司', reading: 'すし', dictionary: 'Jitendex', sequence: 1358280, entries: [structuredContent]});
        expect(buildHimotokiFavorite(entry, context, options).gloss).toStrictEqual('sushi; vinegared rice');
    });

    test('a grouped entry saves the chosen headword with its own sequence and meanings (#10)', () => {
        const entry = createTermEntry({term: '箸', reading: 'はし', dictionary: 'Jitendex', sequence: 1206590, entries: ['chopsticks']});
        entry.headwords.push({...entry.headwords[0], index: 1, term: '橋'});
        entry.definitions.push({...entry.definitions[0], index: 1, headwordIndices: [1], sequences: [1231930], entries: ['bridge']});
        // Both lookups deinflect to 橋, so headword 1 is the matched one.
        for (const headword of entry.headwords) {
            headword.sources = headword.sources.map((source) => ({...source, deinflectedText: '橋'}));
        }
        const favorite = buildHimotokiFavorite(entry, context, options);
        expect([favorite.headword, favorite.seq, favorite.gloss]).toStrictEqual(['橋', 1231930, 'bridge']);
    });

    test('two words whose old 32-bit IDs collide get different identities (#8)', () => {
        const dictionary = 'Custom Japanese Dictionary';
        const georgette = createTermEntry({term: 'ジョーゼット', reading: 'ジョーゼット', dictionary, sequence: 42, entries: ['georgette']});
        const carryIn = createTermEntry({term: '運び込む', reading: 'はこびこむ', dictionary, sequence: 43, entries: ['to carry in; to bring in']});
        // The issue's pair: one ID under the old hash.
        expect(legacyStableSeq('ジョーゼット', 'ジョーゼット', dictionary)).toBe(legacyStableSeq('運び込む', 'はこびこむ', dictionary));

        const first = buildHimotokiFavorite(georgette, context, options);
        const second = buildHimotokiFavorite(carryIn, context, options);
        expect(first.seq).not.toBe(second.seq);
        expect(String(first.seq)).toMatch(/^yt_[0-9a-f]{16}$/);

        let blob = createEmptySavedBlob(1);
        blob = upsertFavorite(blob, first, 2).blob;
        const result = upsertFavorite(blob, second, 3);
        expect(result.added).toBe(true);
        expect(result.blob.favorites.map((f) => f.headword)).toStrictEqual(['運び込む', 'ジョーゼット']);
    });

    test('the popup shows a word saved under its old ID as saved, but not its collision (#19 review)', () => {
        const dictionary = 'Custom Japanese Dictionary';
        const legacy = legacyStableSeq('ジョーゼット', 'ジョーゼット', dictionary);
        // ジョーゼット was saved by an earlier build under the 32-bit ID.
        const savedKeys = new Set([favoriteKey('yomitan', legacy)]);
        const savedWordKeys = new Set([savedWordKey('yomitan', legacy, 'ジョーゼット', 'ジョーゼット')]);
        const georgette = buildHimotokiFavorite(createTermEntry({term: 'ジョーゼット', reading: 'ジョーゼット', dictionary, sequence: 42, entries: ['georgette']}), context, options);
        const carryIn = buildHimotokiFavorite(createTermEntry({term: '運び込む', reading: 'はこびこむ', dictionary, sequence: 43, entries: ['to carry in']}), context, options);
        expect(carryIn.legacySeq).toBe(georgette.legacySeq);
        expect(isFavoriteSaved(georgette, savedKeys, savedWordKeys)).toBe(true);
        expect(isFavoriteSaved(carryIn, savedKeys, savedWordKeys)).toBe(false);
        // Under its current ID a word is saved whatever the legacy keys say.
        expect(isFavoriteSaved(carryIn, new Set([favoriteKey('yomitan', carryIn.seq)]), new Set())).toBe(true);
    });

    test('a word saved under its old 32-bit ID is updated, not duplicated, and a collision is not', () => {
        const dictionary = 'Custom Japanese Dictionary';
        const legacy = legacyStableSeq('ジョーゼット', 'ジョーゼット', dictionary);
        let blob = createEmptySavedBlob(1);
        blob = upsertFavorite(blob, {source: 'yomitan', seq: legacy, headword: 'ジョーゼット', reading: 'ジョーゼット', gloss: 'georgette'}, 2).blob;

        const again = buildHimotokiFavorite(createTermEntry({term: 'ジョーゼット', reading: 'ジョーゼット', dictionary, sequence: 42, entries: ['georgette (fabric)']}), context, options);
        const merged = upsertFavorite(blob, again, 3);
        expect(merged.added).toBe(false);
        expect(merged.blob.favorites).toHaveLength(1);
        expect(merged.blob.favorites[0]).toMatchObject({seq: legacy, gloss: 'georgette (fabric)'});
        expect('legacySeq' in merged.blob.favorites[0]).toBe(false);

        const other = buildHimotokiFavorite(createTermEntry({term: '運び込む', reading: 'はこびこむ', dictionary, sequence: 43, entries: ['to carry in']}), context, options);
        const added = upsertFavorite(blob, other, 4);
        expect(added.added).toBe(true);
        expect(added.blob.favorites.map((f) => f.headword)).toStrictEqual(['運び込む', 'ジョーゼット']);
        expect('legacySeq' in added.blob.favorites[0]).toBe(false);
    });

    test('ruby readings are not saved as part of a structured meaning (#11)', () => {
        /** @type {import('dictionary-data').TermGlossaryContent} */
        const structuredContent = {
            type: 'structured-content',
            content: {
                tag: 'span',
                content: [
                    {tag: 'ruby', content: ['新聞', {tag: 'rp', content: '('}, {tag: 'rt', content: 'しんぶん'}, {tag: 'rp', content: ')'}]},
                    'を',
                    {tag: 'ruby', content: ['読', {tag: 'rt', content: 'よ'}]},
                    'む',
                ],
            },
        };
        const entry = createTermEntry({term: '購読', reading: 'こうどく', dictionary: 'Custom Dict', sequence: 1, entries: [structuredContent]});
        expect(buildHimotokiFavorite(entry, context, options).gloss).toBe('新聞を読む');
    });

    test('keeps every numeric pitch pattern of the chosen headword, once each (#18)', () => {
        const entry = createTermEntry({term: '打ち込む', reading: 'うちこむ', dictionary: 'Jitendex', sequence: 1, entries: ['to drive in']});
        /**
         * @param {number|string} positions
         * @returns {import('dictionary').PitchAccent}
         */
        const pitch = (positions) => ({type: 'pitch-accent', positions, nasalPositions: [], devoicePositions: [], tags: []});
        entry.pronunciations = /** @type {import('dictionary').TermPronunciation[]} */ (/** @type {unknown} */ ([
            {index: 0, headwordIndex: 0, dictionary: 'A', dictionaryIndex: 0, dictionaryAlias: 'A', pronunciations: [pitch(0), pitch(3)]},
            {index: 1, headwordIndex: 0, dictionary: 'B', dictionaryIndex: 1, dictionaryAlias: 'B', pronunciations: [pitch(3), pitch('HLLL')]},
            {index: 2, headwordIndex: 1, dictionary: 'A', dictionaryIndex: 0, dictionaryAlias: 'A', pronunciations: [pitch(2)]},
        ]));
        expect(buildHimotokiFavorite(entry, context, options).pitch).toBe('0/3');
        entry.pronunciations = [];
        expect(buildHimotokiFavorite(entry, context, options).pitch).toBe('');
    });
});
