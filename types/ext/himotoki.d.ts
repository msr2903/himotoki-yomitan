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

/** Input accepted by an add-or-merge save, mirroring `FavoriteInput` in Himotoki's sync package. */
export type FavoriteInput = {
    source?: string;
    seq: string | number;
    headword: string;
    reading?: string;
    gloss?: string;
    pitch?: string;
    folderIds?: string[];
    contextSentence?: string;
    sourceUrl?: string;
    videoTitle?: string;
    timestampMs?: number;
};

export type Favorite = {
    source: string;
    seq: string | number;
    headword: string;
    reading: string;
    gloss: string;
    pitch?: string;
    folderIds: string[];
    savedAt: number;
    contextSentence?: string;
    sourceUrl?: string;
    videoTitle?: string;
    timestampMs?: number;
};

export type Folder = {
    id: string;
    name: string;
    createdAt: number;
};

/** The `saved/{uid}` Firestore document. */
export type SavedBlob = {
    version: number;
    folders: Folder[];
    favorites: Favorite[];
    likes: unknown[];
    lastFolderId: string;
    updatedAt: number;
};

export type UpsertResult = {
    blob: SavedBlob;
    added: boolean;
};

/** Persisted Firebase session, stored in `chrome.storage.local`. */
export type Session = {
    uid: string;
    email: string;
    displayName: string;
    idToken: string;
    refreshToken: string;
    /** Epoch milliseconds at which `idToken` expires. */
    expiresAt: number;
};

export type Status = {
    /** Whether Google sign-in can be started (OAuth client configured and `identity` API present). */
    signInAvailable: boolean;
    signedIn: boolean;
    email: string;
    displayName: string;
    /** The OAuth redirect URL that must be registered for this extension ID. */
    redirectUrl: string;
};

export type SavedSummary = {
    favoriteKeys: string[];
    folders: Folder[];
};

export type AddFavoriteResult = {
    added: boolean;
};

export type FirestoreValue =
    {nullValue: null} |
    {booleanValue: boolean} |
    {integerValue: string} |
    {doubleValue: number} |
    {timestampValue: string} |
    {stringValue: string} |
    {arrayValue: {values?: FirestoreValue[]}} |
    {mapValue: {fields?: FirestoreFields}};

export type FirestoreFields = {
    [key: string]: FirestoreValue;
};

export type FirestoreDocument = {
    name?: string;
    fields?: FirestoreFields;
    updateTime?: string;
};

export type GoogleApiErrorResponse = {
    error?: {
        code?: number;
        message?: string;
        status?: string;
    } | string;
    error_description?: string;
};

export type SignInWithIdpResponse = {
    localId: string;
    email?: string;
    displayName?: string;
    idToken: string;
    refreshToken: string;
    expiresIn: string;
};

export type RefreshTokenResponse = {
    id_token: string;
    refresh_token: string;
    expires_in: string;
    user_id: string;
};
