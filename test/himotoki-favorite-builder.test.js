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
import {buildHimotokiFavorite, stableSeq} from '../ext/js/data/himotoki-favorite-builder.js';
import {favoriteKey} from '../ext/js/data/himotoki-saved-blob.js';

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
});
