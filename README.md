# SetterScraper

SetterScraper is a Chrome Manifest V3 extension that syncs records from a configured CRM into Google Sheets.

It was built for sales teams that want a single action to turn a CRM pipeline into a working spreadsheet with client details, appointments, follow-ups, and basic performance summaries.

> **Public portfolio version:** company-specific URLs, database project IDs, authentication-store names, collection names, and field mappings have been replaced with placeholders. The public repository documents the architecture without exposing the original company integration. It will not connect to a real CRM until you create a private `config.js` with the appropriate values.

## What it does

- Reads the current authenticated CRM session from the tab you already have open.
- Pulls records, related projects, assigned users, and appointment information.
- Creates or updates a Google Sheet for the pipeline.
- Adds tabs for records, today&rsquo;s appointments, follow-ups, stats, and draft messages.
- Tracks new records and preserves the spreadsheet across future syncs.
- Shows sync progress and the sheet link in the extension popup.

## Architecture

The extension uses a Manifest V3 service worker. When a sync starts, the worker reads the active session from the CRM tab, queries the configured document-database API, normalizes the records, and writes them through the Google Sheets API.

There is no application server. Tokens are kept in memory during a sync, while the extension stores only local sync state such as the spreadsheet ID, last sync time, and summary counts.

## Local setup

1. Copy `config.example.js` to `config.js`.
2. Replace the placeholder CRM origin, document API endpoint, auth-store names, collection names, and field mappings in `config.js`.
3. Replace the placeholder OAuth client ID in `manifest.json` and update the CRM host permission.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder.
5. Open the configured CRM, sign in, click the SetterScraper toolbar icon, and complete the setup screen.
6. Click **Sync Now**.

The private `config.js` file is ignored by Git. Do not commit it, OAuth credentials, private keys, session exports, or generated customer data.

## Files

- `manifest.json` — extension permissions, OAuth configuration, and service-worker registration
- `config.example.js` — anonymized integration configuration template
- `background.js` — CRM extraction, document-database reads, Google Sheets sync, and spreadsheet formatting
- `popup.html` / `popup.js` — setup, sync controls, progress, and status UI
- `preview.html` — static visual preview of popup states
- `get-key.js` — local helper for deriving a Chrome extension public key from a private PEM

## Permissions

The extension requests access to the configured CRM, Google Sheets, Google Drive file creation, browser tabs, scripting, local storage, and Google OAuth. It only reads CRM data when the user starts a sync.

Review the permissions and source before installing it in an account containing customer information.

## Privacy

The extension sends records to the Google Sheet created in the signed-in Google account. It does not use hosted analytics or a separate application backend. Do not share generated spreadsheets publicly.

## License

No license has been selected yet.
