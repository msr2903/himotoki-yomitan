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

import {toError} from '../../core/to-error.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';

export class HimotokiController {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     */
    constructor(settingsController) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {HTMLElement} */
        this._accountStatus = querySelectorNotNull(document, '#himotoki-account-status');
        /** @type {HTMLElement} */
        this._signInUnavailable = querySelectorNotNull(document, '#himotoki-sign-in-unavailable');
        /** @type {HTMLElement} */
        this._redirectUrl = querySelectorNotNull(document, '#himotoki-redirect-url');
        /** @type {HTMLButtonElement} */
        this._signInButton = querySelectorNotNull(document, '#himotoki-sign-in');
        /** @type {HTMLButtonElement} */
        this._signOutButton = querySelectorNotNull(document, '#himotoki-sign-out');
        /** @type {HTMLSelectElement} */
        this._folderSelect = querySelectorNotNull(document, '#himotoki-folder');
        /** @type {string} */
        this._folderId = '';
    }

    /** */
    async prepare() {
        this._signInButton.addEventListener('click', this._onSignInClick.bind(this), false);
        this._signOutButton.addEventListener('click', this._onSignOutClick.bind(this), false);
        this._settingsController.on('optionsChanged', this._onOptionsChanged.bind(this));

        const options = await this._settingsController.getOptions();
        this._onOptionsChanged({options});
        await this._refreshStatus();
    }

    // Private

    /**
     * @param {{options: import('settings').ProfileOptions}} details
     */
    _onOptionsChanged({options}) {
        this._folderId = options.himotoki.folderId;
        this._updateFolderSelectValue();
    }

    /** */
    async _onSignInClick() {
        await this._runAccountAction('Signing in…', () => this._settingsController.application.api.himotokiSignIn());
    }

    /** */
    async _onSignOutClick() {
        await this._runAccountAction('Signing out…', () => this._settingsController.application.api.himotokiSignOut());
    }

    /**
     * @param {string} pendingMessage
     * @param {() => Promise<import('himotoki').Status>} action
     */
    async _runAccountAction(pendingMessage, action) {
        this._signInButton.disabled = true;
        this._signOutButton.disabled = true;
        this._accountStatus.textContent = pendingMessage;
        try {
            await this._applyStatus(await action());
        } catch (e) {
            await this._refreshStatus();
            this._accountStatus.textContent = toError(e).message;
        } finally {
            this._signInButton.disabled = false;
            this._signOutButton.disabled = false;
        }
    }

    /** */
    async _refreshStatus() {
        try {
            await this._applyStatus(await this._settingsController.application.api.himotokiGetStatus());
        } catch (e) {
            this._accountStatus.textContent = toError(e).message;
        }
    }

    /**
     * @param {import('himotoki').Status} status
     */
    async _applyStatus({signInAvailable, signedIn, email, displayName, redirectUrl}) {
        this._signInButton.hidden = signedIn || !signInAvailable;
        this._signOutButton.hidden = !signedIn;
        this._signInUnavailable.hidden = signedIn || signInAvailable;
        this._redirectUrl.textContent = redirectUrl;

        if (!signedIn) {
            this._accountStatus.textContent = 'Not signed in. Sign in with the Google account you use on Himotoki to save words in one click.';
            this._setFolders([]);
            return;
        }

        const name = displayName && email ? `${displayName} (${email})` : (email || displayName || 'your Google account');
        this._accountStatus.textContent = `Signed in as ${name}.`;
        try {
            const {favoriteKeys, folders} = await this._settingsController.application.api.himotokiGetSaved(true);
            this._accountStatus.textContent = `Signed in as ${name} · ${favoriteKeys.length} saved word${favoriteKeys.length === 1 ? '' : 's'}.`;
            this._setFolders(folders);
        } catch (e) {
            this._accountStatus.textContent = `Signed in as ${name}, but your saved words couldn't be loaded: ${toError(e).message}`;
        }
    }

    /**
     * @param {import('himotoki').Folder[]} folders
     */
    _setFolders(folders) {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(this._createFolderOption('', 'Unfiled'));
        for (const {id, name} of folders) {
            fragment.appendChild(this._createFolderOption(id, name));
        }
        this._folderSelect.textContent = '';
        this._folderSelect.appendChild(fragment);
        this._folderSelect.disabled = folders.length === 0;
        this._updateFolderSelectValue();
    }

    /**
     * Keeps a folder chosen while signed in visible while signed out or before folders load.
     */
    _updateFolderSelectValue() {
        const folderId = this._folderId;
        if (folderId.length > 0 && this._folderSelect.querySelector(`option[value="${CSS.escape(folderId)}"]`) === null) {
            this._folderSelect.appendChild(this._createFolderOption(folderId, `Folder ${folderId}`));
        }
        this._folderSelect.value = folderId;
    }

    /**
     * @param {string} value
     * @param {string} label
     * @returns {HTMLOptionElement}
     */
    _createFolderOption(value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }
}
