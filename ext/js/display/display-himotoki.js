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

import {HIMOTOKI_WEB_URL} from '../comm/himotoki-client.js';
import {EventListenerCollection} from '../core/event-listener-collection.js';
import {toError} from '../core/to-error.js';
import {buildHimotokiFavorite} from '../data/himotoki-favorite-builder.js';
import {favoriteKey} from '../data/himotoki-saved-blob.js';

export class DisplayHimotoki {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {?import('settings').HimotokiOptions} */
        this._options = null;
        /** @type {boolean} */
        this._signedIn = false;
        /** @type {?import('anki-templates-internal').Context} */
        this._noteContext = null;
        /** @type {EventListenerCollection} */
        this._eventListeners = new EventListenerCollection();
        /** @type {Set<string>} */
        this._savedKeys = new Set();
        /** @type {?import('core').TokenObject} */
        this._updateToken = null;
        /** @type {?import('./display-notification.js').DisplayNotification} */
        this._errorNotification = null;
        /** @type {(event: MouseEvent) => void} */
        this._onSaveButtonClickBind = this._onSaveButtonClick.bind(this);
    }

    /** */
    prepare() {
        this._display.hotkeyHandler.registerActions([
            ['addHimotokiNote', this._onHotkeySave.bind(this)],
        ]);
        this._display.on('optionsUpdated', this._onOptionsUpdated.bind(this));
        this._display.on('contentClear', this._onContentClear.bind(this));
        this._display.on('contentUpdateStart', this._onContentUpdateStart.bind(this));
        this._display.on('contentUpdateComplete', this._onContentUpdateComplete.bind(this));
    }

    // Private

    /**
     * @param {import('display').EventArgument<'optionsUpdated'>} details
     */
    _onOptionsUpdated({options}) {
        this._options = options.himotoki;
    }

    /** */
    _onContentClear() {
        this._eventListeners.removeAllEventListeners();
        this._updateToken = null;
        this._hideErrorNotification(false);
    }

    /** */
    _onContentUpdateStart() {
        this._noteContext = this._getNoteContext();
        this._eventListeners.removeAllEventListeners();
        this._updateToken = null;
    }

    /** */
    _onContentUpdateComplete() {
        if (this._options === null || !this._options.enable) { return; }
        const {dictionaryEntries} = this._display;
        for (let i = 0, ii = dictionaryEntries.length; i < ii; ++i) {
            this._createSaveButton(i);
        }
        void this._updateSavedState();
    }

    /**
     * @param {number} index
     */
    _createSaveButton(index) {
        const entry = this._getEntry(index);
        if (entry === null) { return; }
        const actions = entry.querySelector('.actions');
        if (actions === null) { return; }

        const container = document.createElement('div');
        container.className = 'himotoki-actions-container';
        const button = /** @type {HTMLButtonElement} */ (this._display.displayGenerator.instantiateTemplate('himotoki-save-button'));
        button.dataset.entryIndex = `${index}`;
        this._eventListeners.addEventListener(button, 'click', this._onSaveButtonClickBind);
        container.appendChild(button);
        actions.appendChild(container);
    }

    /**
     * Loads sign-in state and the saved-word list (cached by the backend) to mark saved entries.
     */
    async _updateSavedState() {
        /** @type {?import('core').TokenObject} */
        const token = {};
        this._updateToken = token;
        try {
            const {api} = this._display.application;
            const {signedIn} = await api.himotokiGetStatus();
            const {favoriteKeys} = signedIn ? await api.himotokiGetSaved(false) : {favoriteKeys: []};
            if (this._updateToken !== token) { return; }
            this._signedIn = signedIn;
            this._savedKeys = new Set(favoriteKeys);
        } catch {
            // Errors are reported when saving; the buttons stay usable.
            if (this._updateToken !== token) { return; }
        }
        for (const button of this._getSaveButtons()) {
            this._updateButtonState(button);
        }
    }

    /**
     * @returns {HTMLButtonElement[]}
     */
    _getSaveButtons() {
        return [...document.querySelectorAll('.action-button[data-action=save-himotoki]')].map((node) => /** @type {HTMLButtonElement} */ (node));
    }

    /**
     * @param {HTMLButtonElement} button
     */
    _updateButtonState(button) {
        const favorite = this._buildFavorite(Number.parseInt(button.dataset.entryIndex ?? '', 10));
        const saved = favorite !== null && this._savedKeys.has(favoriteKey(favorite.source, favorite.seq));
        this._setButtonState(button, saved ? 'saved' : 'ready');
    }

    /**
     * @param {HTMLButtonElement} button
     * @param {'ready'|'saving'|'saved'|'error'} state
     */
    _setButtonState(button, state) {
        button.dataset.himotokiState = state;
        button.disabled = state === 'saving';
        button.classList.toggle('action-button-himotoki-saved', state === 'saved');
        switch (state) {
            case 'saving':
                button.title = 'Saving to Himotoki…';
                break;
            case 'saved':
                button.title = 'Saved to Himotoki (click to update)';
                break;
            default:
                button.title = this._signedIn ? 'Add to Himotoki' : 'Add to Himotoki (sign in under Settings → Himotoki for one-click saving)';
                break;
        }
    }

    /**
     * @param {MouseEvent} e
     */
    _onSaveButtonClick(e) {
        e.preventDefault();
        const button = /** @type {HTMLButtonElement} */ (e.currentTarget);
        void this._save(Number.parseInt(button.dataset.entryIndex ?? '', 10), button);
    }

    /** */
    _onHotkeySave() {
        const index = this._display.selectedIndex;
        const button = this._getEntry(index)?.querySelector('.action-button[data-action=save-himotoki]');
        void this._save(index, typeof button === 'object' && button !== null ? /** @type {HTMLButtonElement} */ (button) : null);
    }

    /**
     * @param {number} index
     * @param {?HTMLButtonElement} button
     */
    async _save(index, button) {
        this._hideErrorNotification(true);
        /** @type {?import('himotoki').FavoriteInput} */
        let favorite;
        try {
            favorite = this._buildFavorite(index);
        } catch (e) {
            this._showError(toError(e).message);
            return;
        }
        if (favorite === null) { return; }

        if (!this._signedIn) {
            this._openQuickAdd(favorite);
            return;
        }

        if (button !== null) { this._setButtonState(button, 'saving'); }
        try {
            await this._display.application.api.himotokiAddFavorite(favorite);
            this._savedKeys.add(favoriteKey(favorite.source, favorite.seq));
            if (button !== null) { this._setButtonState(button, 'saved'); }
        } catch (e) {
            if (button !== null) { this._setButtonState(button, 'error'); }
            this._showError(`Couldn't save to Himotoki: ${toError(e).message}`);
        }
    }

    /**
     * @param {number} index
     * @returns {?import('himotoki').FavoriteInput}
     */
    _buildFavorite(index) {
        const dictionaryEntry = this._display.dictionaryEntries[index];
        if (typeof dictionaryEntry === 'undefined' || this._options === null || this._noteContext === null) { return null; }
        return buildHimotokiFavorite(dictionaryEntry, this._noteContext, this._options);
    }

    /**
     * Opens Himotoki's quick-add page, which saves through the user's website session.
     * @param {import('himotoki').FavoriteInput} favorite
     */
    _openQuickAdd({headword, contextSentence, sourceUrl, videoTitle}) {
        const url = new URL('/save', HIMOTOKI_WEB_URL);
        url.searchParams.set('text', headword);
        if (contextSentence) { url.searchParams.set('sentence', contextSentence); }
        if (sourceUrl) { url.searchParams.set('url', sourceUrl); }
        if (videoTitle) { url.searchParams.set('title', videoTitle); }
        window.open(url.toString(), '_blank', 'noopener');
    }

    /**
     * @param {number} index
     * @returns {?HTMLElement}
     */
    _getEntry(index) {
        const entries = this._display.dictionaryEntryNodes;
        return index >= 0 && index < entries.length ? entries[index] : null;
    }

    /**
     * @returns {import('anki-templates-internal').Context}
     */
    _getNoteContext() {
        const {state} = this._display.history;
        let documentTitle;
        let url;
        let sentence;
        if (typeof state === 'object' && state !== null) {
            ({documentTitle, url, sentence} = state);
        }
        if (typeof documentTitle !== 'string') {
            documentTitle = document.title;
        }
        if (typeof url !== 'string') {
            url = window.location.href;
        }
        const {query, fullQuery, queryOffset} = this._display;
        if (typeof sentence !== 'object' || sentence === null) {
            sentence = {text: fullQuery, offset: queryOffset};
        }
        return {url, sentence, documentTitle, query, fullQuery};
    }

    /**
     * @param {string} message
     */
    _showError(message) {
        if (this._errorNotification === null) {
            this._errorNotification = this._display.createNotification(false);
        }
        this._errorNotification.setContent(message);
        this._errorNotification.open();
    }

    /**
     * @param {boolean} animate
     */
    _hideErrorNotification(animate) {
        if (this._errorNotification === null) { return; }
        this._errorNotification.close(animate);
    }
}
