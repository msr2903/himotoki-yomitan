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
 * Build a Himotoki favorite payload from a Yomitan dictionary entry.
 * Dictionary lookup stays in Yomitan — we only map fields for cloud save.
 */

/**
 * @param {import('dictionary').DictionaryEntry} dictionaryEntry
 * @param {import('anki-templates-internal').Context} context
 * @param {import('settings').HimotokiOptions} options
 * @returns {import('himotoki').FavoriteInput}
 */
export function buildHimotokiFavorite(dictionaryEntry, context, options) {
    if (dictionaryEntry.type === 'kanji') {
        return buildKanjiFavorite(dictionaryEntry, context, options);
    }
    return buildTermFavorite(dictionaryEntry, context, options);
}

/**
 * @param {import('dictionary').TermDictionaryEntry} dictionaryEntry
 * @param {import('anki-templates-internal').Context} context
 * @param {import('settings').HimotokiOptions} options
 * @returns {import('himotoki').FavoriteInput}
 */
function buildTermFavorite(dictionaryEntry, context, options) {
    const {term, reading, headwordIndex} = pickHeadword(dictionaryEntry);
    const {source, seq} = resolveIdentity(dictionaryEntry, term, reading);
    const gloss = extractGloss(dictionaryEntry);
    const pitch = extractPitch(dictionaryEntry, headwordIndex);

    /** @type {import('himotoki').FavoriteInput} */
    const favorite = {
        source,
        seq,
        headword: term,
        reading: reading || '',
        gloss,
        pitch,
        folderIds: folderIdsFromOptions(options),
    };

    applyMiningFields(favorite, context, options);
    return favorite;
}

/**
 * @param {import('dictionary').KanjiDictionaryEntry} dictionaryEntry
 * @param {import('anki-templates-internal').Context} context
 * @param {import('settings').HimotokiOptions} options
 * @returns {import('himotoki').FavoriteInput}
 */
function buildKanjiFavorite(dictionaryEntry, context, options) {
    const character = dictionaryEntry.character;
    const gloss = (dictionaryEntry.definitions || []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 8).join('; ');
    const seq = stableSeq(character, '', dictionaryEntry.dictionary || 'kanji');

    /** @type {import('himotoki').FavoriteInput} */
    const favorite = {
        source: 'yomitan',
        seq,
        headword: character,
        reading: '',
        gloss,
        pitch: '',
        folderIds: folderIdsFromOptions(options),
    };

    applyMiningFields(favorite, context, options);
    return favorite;
}

/**
 * Prefer JMDict-compatible sequence from Yomitan when present; otherwise stable yomitan id.
 * @param {import('dictionary').TermDictionaryEntry} dictionaryEntry
 * @param {string} term
 * @param {string} reading
 * @returns {{source: string, seq: string|number}}
 */
function resolveIdentity(dictionaryEntry, term, reading) {
    for (const definition of dictionaryEntry.definitions) {
        for (const sequence of definition.sequences) {
            if (typeof sequence === 'number' && sequence >= 0) {
                return {
                    source: sourceFromDictionaryName(definition.dictionary),
                    seq: sequence,
                };
            }
        }
    }
    return {
        source: 'yomitan',
        seq: stableSeq(term, reading, dictionaryEntry.definitions[0]?.dictionary || ''),
    };
}

/**
 * @param {string} dictionaryName
 * @returns {string}
 */
function sourceFromDictionaryName(dictionaryName) {
    const name = (dictionaryName || '').toLowerCase();
    if (name.includes('jitendex')) { return 'jitendex'; }
    if (name.includes('jmdict') || name.includes('jmdictdb')) { return 'jmdict'; }
    // JMDict-compatible packs share sequence numbers; Himotoki word pages prefer jitendex.
    return 'jitendex';
}

/**
 * @param {import('dictionary').TermDictionaryEntry} dictionaryEntry
 * @returns {{term: string, reading: string, headwordIndex: number}}
 */
function pickHeadword(dictionaryEntry) {
    const {headwords} = dictionaryEntry;
    let bestIndex = 0;
    for (let i = 0, ii = headwords.length; i < ii; ++i) {
        const {term, reading, sources} = headwords[i];
        for (const {deinflectedText} of sources) {
            if (term === deinflectedText) {
                return {term, reading, headwordIndex: i};
            }
            if (reading === deinflectedText && bestIndex === 0) {
                bestIndex = i;
            }
        }
    }
    const headword = headwords[Math.max(0, bestIndex)] || headwords[0];
    return {
        term: headword?.term || dictionaryEntry.headwords[0]?.term || '',
        reading: headword?.reading || '',
        headwordIndex: Math.max(0, bestIndex),
    };
}

/**
 * @param {import('dictionary').TermDictionaryEntry} dictionaryEntry
 * @returns {string}
 */
function extractGloss(dictionaryEntry) {
    /** @type {string[]} */
    const parts = [];
    for (const definition of dictionaryEntry.definitions) {
        for (const entry of definition.entries) {
            const text = glossaryToText(entry);
            if (text) { parts.push(text); }
            if (parts.length >= 8) { break; }
        }
        if (parts.length >= 8) { break; }
    }
    return parts.join('; ').slice(0, 500);
}

/**
 * @param {import('dictionary-data').TermGlossaryContent} entry
 * @returns {string}
 */
function glossaryToText(entry) {
    if (typeof entry === 'string') { return entry.trim(); }
    if (entry && typeof entry === 'object') {
        if (entry.type === 'text' && typeof entry.text === 'string') {
            return entry.text.trim();
        }
        if (entry.type === 'structured-content') {
            /** @type {unknown[]} */
            const glossaryLists = [];
            findGlossaryLists(entry.content, glossaryLists);
            const content = glossaryLists.length > 0 ? glossaryLists : entry.content;
            return normalizeWhitespace(structuredContentToText(content));
        }
    }
    return '';
}

/**
 * Collects nodes marked as glossary lists (Jitendex-style `data: {content: 'glossary'}`),
 * which excludes example sentences, notes, and other auxiliary content.
 * @param {unknown} content
 * @param {unknown[]} results
 */
function findGlossaryLists(content, results) {
    if (Array.isArray(content)) {
        for (const child of content) { findGlossaryLists(child, results); }
        return;
    }
    if (content === null || typeof content !== 'object') { return; }
    const node = /** @type {{content?: unknown, data?: Record<string, unknown>}} */ (content);
    if (node.data?.content === 'glossary') {
        results.push(node);
        return;
    }
    if ('content' in node) { findGlossaryLists(node.content, results); }
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function structuredContentToText(content) {
    if (typeof content === 'string') { return content; }
    if (Array.isArray(content)) {
        return content.map((c) => structuredContentToText(c)).join('');
    }
    if (content !== null && typeof content === 'object') {
        const node = /** @type {{tag?: string, content?: unknown, text?: string}} */ (content);
        if (typeof node.text === 'string') { return node.text; }
        if (node.tag === 'br') { return ' '; }
        const text = 'content' in node ? structuredContentToText(node.content) : '';
        return node.tag === 'li' ? `${text}; ` : text;
    }
    return '';
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
    return text
        .replaceAll(/\s+/g, ' ')
        .replaceAll(/\s*;(\s*;)+/g, ';')
        .replace(/(\s*;\s*)+$/, '')
        .trim();
}

/**
 * @param {import('dictionary').TermDictionaryEntry} dictionaryEntry
 * @param {number} headwordIndex
 * @returns {string}
 */
function extractPitch(dictionaryEntry, headwordIndex) {
    for (const group of dictionaryEntry.pronunciations) {
        if (group.headwordIndex !== headwordIndex) { continue; }
        for (const pronunciation of group.pronunciations) {
            if (pronunciation.type === 'pitch-accent') {
                return String(pronunciation.positions);
            }
        }
    }
    return '';
}

/**
 * @param {import('himotoki').FavoriteInput} favorite
 * @param {import('anki-templates-internal').Context} context
 * @param {import('settings').HimotokiOptions} options
 */
function applyMiningFields(favorite, context, options) {
    if (options.includeSentence !== false) {
        const sentence = context?.sentence?.text;
        if (typeof sentence === 'string' && sentence.trim()) {
            favorite.contextSentence = sentence.trim().slice(0, 1000);
        }
    }
    if (options.includeUrl !== false) {
        const url = context?.url;
        if (typeof url === 'string' && url && !url.startsWith('chrome-extension:') && !url.startsWith('moz-extension:')) {
            favorite.sourceUrl = url.slice(0, 2000);
        }
    }
    const title = context?.documentTitle;
    if (typeof title === 'string' && title.trim()) {
        favorite.videoTitle = title.trim().slice(0, 200);
    }
}

/**
 * @param {import('settings').HimotokiOptions} options
 * @returns {string[]}
 */
function folderIdsFromOptions(options) {
    const id = (options.folderId || '').trim();
    return id ? [id] : [];
}

/**
 * Stable non-JMDict identity when Yomitan has no sequence.
 * @param {string} term
 * @param {string} reading
 * @param {string} dictionary
 * @returns {string}
 */
export function stableSeq(term, reading, dictionary) {
    const raw = `${term}\u0000${reading}\u0000${dictionary}`;
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `yt_${(hash >>> 0).toString(16)}`;
}
