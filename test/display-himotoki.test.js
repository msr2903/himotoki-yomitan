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

import {afterEach, describe, expect, vi} from 'vitest';
import {DisplayHimotoki} from '../ext/js/display/display-himotoki.js';
import {createDomTest} from './fixtures/dom-test.js';

const test = createDomTest();

afterEach(() => { vi.unstubAllGlobals(); });

/** @returns {import('dictionary').TermDictionaryEntry} */
function catEntry() {
    return /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        definitions: [{index: 0, headwordIndices: [0], dictionary: 'Jitendex', sequences: [1467640], entries: ['cat']}],
        headwords: [{index: 0, term: '猫', reading: 'ねこ', sources: [{deinflectedText: '猫'}]}],
        pronunciations: [],
    }));
}

/**
 * The parts of Display that DisplayHimotoki uses, with one 猫 entry on screen.
 * @param {Document} document
 * @param {{enable: boolean, signedIn?: boolean}} details
 * @returns {{api: Record<string, import('vitest').Mock>, saves: {resolve: () => void}[], open: import('vitest').Mock, hotkey: () => void, button: () => ?HTMLButtonElement, refresh: () => void}}
 */
function setup(document, {enable, signedIn = true}) {
    /** @type {Map<string, () => void>} */
    const hotkeys = new Map();
    /** @type {Map<string, (details: unknown) => void>} */
    const events = new Map();
    const entryNode = document.createElement('div');
    const actions = document.createElement('div');
    actions.className = 'actions';
    entryNode.appendChild(actions);
    document.body.appendChild(entryNode);

    /** @type {{resolve: () => void}[]} */
    const saves = [];
    const api = {
        himotokiGetStatus: vi.fn(async () => ({signedIn})),
        himotokiGetSaved: vi.fn(async () => ({favoriteKeys: [], folders: []})),
        himotokiAddFavorite: vi.fn(() => new Promise((resolve) => { saves.push({resolve: () => resolve({added: true})}); })),
    };
    const display = /** @type {import('../ext/js/display/display.js').Display} */ (/** @type {unknown} */ ({
        hotkeyHandler: {registerActions: (/** @type {[string, () => void][]} */ list) => { for (const [name, handler] of list) { hotkeys.set(name, handler); } }},
        on: (/** @type {string} */ name, /** @type {(details: unknown) => void} */ handler) => { events.set(name, handler); },
        dictionaryEntries: [catEntry()],
        dictionaryEntryNodes: [entryNode],
        selectedIndex: 0,
        history: {state: {documentTitle: 'Test', url: 'https://example.test/page', sentence: {text: '猫が好き', offset: 0}}},
        query: '猫',
        fullQuery: '猫が好き',
        queryOffset: 0,
        displayGenerator: {
            instantiateTemplate: () => {
                const button = document.createElement('button');
                button.className = 'action-button';
                button.dataset.action = 'save-himotoki';
                return button;
            },
        },
        application: {api},
        createNotification: () => ({setContent: () => {}, open: () => {}, close: () => {}}),
    }));
    const himotoki = new DisplayHimotoki(display);
    himotoki.prepare();
    /** @type {(details: unknown) => void} */ (events.get('optionsUpdated'))({options: {himotoki: {enable, folderId: '', includeSentence: true, includeUrl: true}}});
    /** @type {() => void} */ (events.get('contentUpdateStart'))();
    /** @type {(details: unknown) => void} */ (events.get('contentUpdateComplete'))({});
    const open = vi.fn();
    vi.stubGlobal('open', open);
    return {
        api,
        saves,
        open,
        hotkey: () => /** @type {() => void} */ (hotkeys.get('addHimotokiNote'))(),
        button: () => /** @type {?HTMLButtonElement} */ (actions.querySelector('button')),
        // The popup re-renders its entries: the old buttons are gone.
        refresh: () => {
            actions.replaceChildren();
            /** @type {(details: unknown) => void} */ (events.get('contentUpdateComplete'))({});
        },
    };
}

describe('Himotoki popup saving', () => {
    test('the hotkey does nothing while the integration is off (#3)', async ({window}) => {
        const {api, open, hotkey, button} = setup(window.document, {enable: false, signedIn: false});
        expect(button()).toBeNull();
        hotkey();
        await Promise.resolve();
        expect(open).not.toHaveBeenCalled();
        expect(api.himotokiAddFavorite).not.toHaveBeenCalled();
    });

    test('a second hotkey press waits for the first save of the same word (#4)', async ({window}) => {
        const {api, saves, hotkey, button} = setup(window.document, {enable: true});
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('ready'));
        hotkey();
        hotkey();
        await vi.waitFor(() => expect(api.himotokiAddFavorite).toHaveBeenCalledTimes(1));
        expect(button()?.disabled).toBe(true);
        saves[0].resolve();
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('saved'));
        hotkey();
        await vi.waitFor(() => expect(api.himotokiAddFavorite).toHaveBeenCalledTimes(2));
    });

    test('a saved-state refresh keeps a pending save button disabled (#4)', async ({window}) => {
        const {api, saves, hotkey, button, refresh} = setup(window.document, {enable: true});
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('ready'));
        hotkey();
        await vi.waitFor(() => expect(api.himotokiAddFavorite).toHaveBeenCalledTimes(1));
        refresh(); // recreates the buttons and reloads saved state
        await vi.waitFor(() => expect(api.himotokiGetSaved).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('saving'));
        expect(button()?.disabled).toBe(true);
        expect(window.document.querySelectorAll('.actions button')).toHaveLength(1);
        saves[0].resolve();
        // The re-rendered button, not the detached one, shows the result.
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('saved'));
        expect(button()?.disabled).toBe(false);
    });

    test('a failed save shows on the re-rendered button too (#4 review)', async ({window}) => {
        const {api, hotkey, button, refresh} = setup(window.document, {enable: true});
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('ready'));
        /** @type {() => void} */
        let fail = () => {};
        api.himotokiAddFavorite.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('offline')); }));
        hotkey();
        await vi.waitFor(() => expect(api.himotokiAddFavorite).toHaveBeenCalledTimes(1));
        refresh(); // re-rendered while the save runs
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('saving'));
        fail();
        await vi.waitFor(() => expect(button()?.dataset.himotokiState).toBe('error'));
        expect(button()?.disabled).toBe(false);
    });
});
