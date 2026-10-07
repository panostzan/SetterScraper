# SetterScraper

SetterScraper is a Chrome extension that syncs a logged-in Nuvohub client list into a Google Sheet.

It was built for sales reps who want one click to turn their Nuvohub pipeline into a working spreadsheet with client details, consultation dates, project managers, follow-ups, and basic performance stats.

## What is Nuvohub?

Nuvohub is the CRM and project-management platform used by residential solar teams to manage leads, clients, appointments, projects, and assigned project managers. SetterScraper turns that working pipeline into a Google Sheet that is easier to review, update, and use for daily follow-up.

## What it does

- Reads the current Nuvohub session from the tab you already have open.
- Pulls client and project information from the Nuvohub account.
- Creates or updates a Google Sheet for the pipeline.
- Adds tabs for all clients, today&rsquo;s sets, follow-ups, stats, and draft messages.
- Tracks new clients and preserves the spreadsheet across future syncs.
- Shows sync progress and the sheet link in the extension popup.

## How it works

The extension uses Manifest V3 with a service worker. A content script reads the Firebase session token from the authenticated Nuvohub tab when a sync starts. The service worker uses that token to retrieve client data, then uses Chrome&rsquo;s Google Identity API to create and update the user&rsquo;s spreadsheet.

No application server is required. Tokens are kept in memory during a sync, while the extension stores only local sync state such as the spreadsheet ID, last sync time, and summary counts.

## Install for development

1. Create or select a Google Cloud project.
2. Enable the Google Sheets API and Google Drive API.
3. Create a Chrome App OAuth client and add the extension ID as an authorized application.
4. Put that OAuth client ID in `manifest.json` under `oauth2.client_id`.
5. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder.
6. Open `https://nuvohub.ca`, sign in, click the SetterScraper toolbar icon, and complete the setup screen.
7. Click **Sync Now**.

The extension is intentionally tied to the Nuvohub account structure and may need updates if Nuvohub changes its data model or authentication flow.

## Files

- `manifest.json` â€” extension permissions, OAuth configuration, and service-worker registration
- `background.js` â€” Nuvohub extraction, Firestore reads, Google Sheets sync, and spreadsheet formatting
- `content.js` â€” reads the active Firebase session from the Nuvohub tab on request
- `popup.html` / `popup.js` â€” setup, sync controls, progress, and status UI
- `preview.html` â€” static visual preview of the popup states
- `get-key.js` â€” local helper for deriving a Chrome extension public key from a private PEM
- `DEV_SETUP.md` â€” longer setup and Chrome Web Store notes

## Permissions

The extension requests access to the active Nuvohub account, Google Sheets, Google Drive file creation, browser tabs, scripting, local storage, and Google OAuth. It only runs the Nuvohub extraction when the user starts a sync.

Review the permissions and the source before installing it in an account containing customer information.

## Privacy

The extension sends client data to the Google Sheet created in the signed-in Google account. It does not include a hosted analytics service or a separate application backend. Do not share generated spreadsheets publicly.

## License

No license has been selected yet.