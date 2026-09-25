# Himotoki integration

Save words from the Yomitan popup into your [Himotoki](https://himotoki.web.app) library in one click, with Anki-style mining context (sentence, page URL, page title).

## Use

1. Open **Settings → Himotoki**.
2. Click **Sign in with Google** and pick the Google account you use on Himotoki.
3. Turn on **Show "Add to Himotoki" button**. Optionally pick a folder for new words.
4. In the popup or search page, click the book button on an entry (or bind the `addHimotokiNote` hotkey under **Shortcuts**).

Saved entries show a dimmed button. Saving a word that is already in your library updates it instead of creating a duplicate, and saved words appear in Himotoki's saved list and flashcard deck right away.

If you are not signed in (or sign-in is not set up in your build), the button opens Himotoki's quick-add page (`/save`) instead, which saves through your website session after you confirm.

## How it works

- Dictionary lookup stays in Yomitan; Himotoki only stores the word.
- Sign-in uses `chrome.identity.launchWebAuthFlow` to get a Google ID token, which is exchanged for a Firebase session (`accounts:signInWithIdp`). The session is kept in `chrome.storage.local` (not in settings or backups) and refreshed automatically.
- Words are written to the `saved/{uid}` Firestore document with the same add-or-merge rules as Himotoki's `@msr2903/sync` package, using an optimistic read-modify-write that retries if the website writes at the same time.
- If a Yomitan entry has a JMdict-compatible sequence number, it is saved as `jitendex`/`jmdict` so the Himotoki word page opens. Otherwise the source is `yomitan` with a stable hash as the sequence.

## Enabling sign-in in a build

Sign-in needs a Google OAuth client in the `himotoki` GCP project:

1. In the GCP console → **APIs & Services → Credentials**, create (or reuse) an OAuth client of type **Web application**.
2. Add the redirect URL shown in **Settings → Himotoki** (`https://<extension-id>.chromiumapp.org/`) to its **Authorized redirect URIs**. Each browser and extension ID has its own redirect URL; unpacked builds get an ID derived from their folder path unless the manifest has a fixed `key`.
3. Set `GOOGLE_OAUTH_CLIENT_ID` in `ext/js/comm/himotoki-client.js` and rebuild.
