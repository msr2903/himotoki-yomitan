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
import {normalizeRequestUrl} from '../ext/js/background/request-builder.js';
import {AudioDownloader} from '../ext/js/media/audio-downloader.js';

/** @type {import('language').LanguageSummary} */
const JAPANESE = /** @type {import('language').LanguageSummary} */ (/** @type {unknown} */ ({iso: 'ja', iso639_3: 'jpn', name: 'Japanese', exampleText: ''}));

/**
 * A downloader whose Commons search returns `filename`, recorded by `user`.
 * @param {string} filename
 * @param {string} user
 * @returns {{downloader: AudioDownloader, urls: URL[]}}
 */
function setup(filename, user) {
    /** @type {URL[]} */
    const urls = [];
    const requestBuilder = /** @type {import('../ext/js/background/request-builder.js').RequestBuilder} */ (/** @type {unknown} */ ({
        fetchAnonymous: async (/** @type {string} */ url) => {
            // What the real RequestBuilder sends, so an escape it undid shows.
            const parsed = new URL(normalizeRequestUrl(url));
            urls.push(parsed);
            const body = parsed.searchParams.get('list') === 'search' ?
                {query: {search: [{title: filename}]}} :
                {query: {pages: {1: {imageinfo: [{url: 'https://upload.wikimedia.org/audio.ogg', user}]}}}};
            return new Response(JSON.stringify(body));
        },
    }));
    return {downloader: new AudioDownloader(requestBuilder), urls};
}

describe('Wikimedia Commons audio for terms with regex or URL characters (#5)', () => {
    test.each([
        ['C++', 'File:Ja-C++.ogg'],
        ['(笑)', 'File:Ja-(笑).ogg'],
        ['猫', 'File:Ja-猫.ogg'],
    ])('Wiktionary finds %s', async (term, filename) => {
        const {downloader, urls} = setup(filename, 'Someone');
        const results = await downloader.getTermAudioInfoList({type: 'wiktionary', url: '', voice: ''}, term, '', JAPANESE);
        expect(results).toHaveLength(1);
        // The term reaches the search as itself, not as "C  ".
        expect(urls[0].searchParams.get('srsearch')).toContain(term.replaceAll(/[()+]/g, '\\$&'));
        expect(urls[1].searchParams.get('titles')).toBe(filename);
    });

    test('Lingua Libre matches terms and contributor names literally', async () => {
        const filename = 'File:LL-Q5287 (jpn)-A.B (user)-C++.wav';
        const {downloader, urls} = setup(filename, 'A.B (user)');
        const results = await downloader.getTermAudioInfoList({type: 'lingua-libre', url: '', voice: ''}, 'C++', '', JAPANESE);
        expect(results).toHaveLength(1);
        expect(urls[0].searchParams.get('srsearch')).toBe('intitle:/-C\\+\\+\\.wav/i incategory:"Lingua_Libre_pronunciation-jpn"');
    });

    test('a regex-like term does not match other recordings', async () => {
        const {downloader} = setup('File:Ja-Cxx.ogg', 'Someone');
        expect(await downloader.getTermAudioInfoList({type: 'wiktionary', url: '', voice: ''}, 'C..', '', JAPANESE)).toStrictEqual([]);
    });
});

describe('request URL normalization (#5 review)', () => {
    test.each([
        ['an encoded + in a query value stays one', 'https://x.test/w?q=C%2B%2B', 'https://x.test/w?q=C%2B%2B'],
        ['other reserved escapes stay', 'https://x.test/w?q=a%26b%3Dc', 'https://x.test/w?q=a%26b%3Dc'],
        ['raw Japanese is encoded', 'https://x.test/w?q=猫', 'https://x.test/w?q=%E7%8C%AB'],
        ['existing escapes are not doubled', 'https://x.test/w?q=%E7%8C%AB', 'https://x.test/w?q=%E7%8C%AB'],
    ])('%s', (_name, input, expected) => {
        expect(normalizeRequestUrl(input)).toBe(expected);
    });

    test('a term with regex anchors is matched literally', async () => {
        const {downloader, urls} = setup('File:Ja-a^b$.ogg', 'Someone');
        await downloader.getTermAudioInfoList({type: 'wiktionary', url: '', voice: ''}, 'a^b$', '', JAPANESE);
        expect(urls[0].searchParams.get('srsearch')).toContain('a\\^b\\$');
    });
});
