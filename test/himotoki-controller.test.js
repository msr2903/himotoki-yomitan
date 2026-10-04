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
import {HimotokiController} from '../ext/js/pages/settings/himotoki-controller.js';
import {createDomTest} from './fixtures/dom-test.js';

const test = createDomTest();

afterEach(() => { vi.unstubAllGlobals(); });

/** The elements of Settings → Himotoki the controller drives. */
const PANEL = [
    ['div', 'himotoki-account-status'],
    ['div', 'himotoki-sign-in-unavailable'],
    ['code', 'himotoki-redirect-url'],
    ['button', 'himotoki-sign-in'],
    ['button', 'himotoki-sign-out'],
    ['select', 'himotoki-folder'],
];

/** @type {import('himotoki').Status} */
const SIGNED_IN = {signInAvailable: true, signedIn: true, email: 'old-account@example.test', displayName: '', redirectUrl: ''};
/** @type {import('himotoki').Status} */
const SIGNED_OUT = {...SIGNED_IN, signedIn: false, email: ''};

/**
 * @param {Document} document
 * @param {{status: import('himotoki').Status, getSaved: () => Promise<import('himotoki').SavedSummary>, signOut?: () => Promise<import('himotoki').Status>, folderId?: string}} details
 * @returns {Promise<HimotokiController>}
 */
async function prepare(document, {status, getSaved, signOut, folderId = ''}) {
    // jsdom has no CSS.escape; the folder IDs here need no escaping.
    vi.stubGlobal('CSS', {escape: (/** @type {string} */ value) => value});
    document.body.replaceChildren(...PANEL.map(([tag, id]) => {
        const element = document.createElement(tag);
        element.id = id;
        return element;
    }));
    const api = {
        himotokiGetStatus: vi.fn(async () => status),
        himotokiGetSaved: vi.fn(getSaved),
        himotokiSignOut: vi.fn(signOut ?? (async () => SIGNED_OUT)),
        himotokiSignIn: vi.fn(async () => status),
    };
    const settingsController = /** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ ({
        application: {api},
        on: () => {},
        getOptions: async () => ({himotoki: {folderId}}),
    }));
    const controller = new HimotokiController(settingsController);
    await controller.prepare();
    return controller;
}

describe('Himotoki settings', () => {
    test('a saved-words read that fails after sign-out does not bring back the old account (#9)', async ({window}) => {
        const {document} = window;
        /** @type {(reason: Error) => void} */
        let rejectRead = () => {};
        const read = new Promise((_resolve, reject) => { rejectRead = reject; });
        const preparing = prepare(document, {status: SIGNED_IN, getSaved: () => /** @type {Promise<import('himotoki').SavedSummary>} */ (read)});
        await vi.waitFor(() => expect(document.querySelector('#himotoki-account-status')?.textContent).toContain('Signed in as old-account'));

        /** @type {HTMLButtonElement} */ (document.querySelector('#himotoki-sign-out')).click();
        await vi.waitFor(() => expect(document.querySelector('#himotoki-account-status')?.textContent).toMatch(/^Not signed in/));
        rejectRead(new Error('Himotoki session changed. Please try again.'));
        await preparing;

        expect(document.querySelector('#himotoki-account-status')?.textContent).toMatch(/^Not signed in/);
        expect(/** @type {HTMLButtonElement} */ (document.querySelector('#himotoki-sign-out')).hidden).toBe(true);
    });

    test('a default folder the account no longer has is shown as missing, not as a choice (#16)', async ({window}) => {
        const {document} = window;
        await prepare(document, {
            status: SIGNED_IN,
            folderId: 'deleted-folder',
            getSaved: async () => ({favoriteKeys: [], folders: [{id: 'anime', name: 'Anime', createdAt: 1}]}),
        });
        const select = /** @type {HTMLSelectElement} */ (document.querySelector('#himotoki-folder'));
        const missing = /** @type {HTMLOptionElement} */ (select.querySelector('option[value="deleted-folder"]'));
        expect(missing.textContent).toBe('Missing folder · words are saved as Unfiled');
        expect(missing.disabled).toBe(true);
        expect(select.value).toBe('deleted-folder');
        expect([...select.options].filter((o) => !o.disabled).map((o) => o.value)).toStrictEqual(['', 'anime']);
    });

    test('while signed out, a chosen folder is kept as it was', async ({window}) => {
        const {document} = window;
        await prepare(document, {status: SIGNED_OUT, folderId: 'anime', getSaved: async () => ({favoriteKeys: [], folders: []})});
        const option = /** @type {HTMLOptionElement} */ (document.querySelector('#himotoki-folder option[value="anime"]'));
        expect(option.textContent).toBe('Folder anime');
        expect(option.disabled).toBe(false);
    });
});
