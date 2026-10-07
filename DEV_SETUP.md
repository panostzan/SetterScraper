# SetterScraper — Developer Setup

## Before loading the extension

### 1. Generate icons
Open `icons/generate_icons.html` in Chrome.
Right-click each canvas → Save image as → save to the `icons/` folder as:
- `icon16.png`
- `icon48.png`
- `icon128.png`

### 2. Google Cloud — one-time setup (you do this, not the user)

1. Go to console.cloud.google.com
2. New project → name it `SetterScraper`
3. Enable **Google Sheets API** and **Google Drive API**
4. APIs & Services → Credentials → Create Credentials → **OAuth 2.0 Client ID**
5. Application type: **Chrome App**
6. Enter your extension ID (see step below to get it)
7. Copy the **Client ID** (ends in `.apps.googleusercontent.com`)
8. Paste it into `manifest.json` → `oauth2.client_id`

### 3. Get your extension ID (for step 2 above)
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `setterscraper` folder
4. Copy the extension ID shown under the extension name
5. Go back to Google Cloud Console and enter it in the OAuth client

### 4. Load the extension
`chrome://extensions` → Developer mode → Load unpacked → select `setterscraper/`

---

## Testing
1. Open `nuvohub.ca` and log in normally
2. Click the SetterScraper icon in the Chrome toolbar
3. Enter your name + company on the setup screen
4. Click **Sync Now**

---

## Publishing to Chrome Web Store
1. Zip the entire `setterscraper/` folder
2. Go to chrome.google.com/webstore/devconsole ($5 one-time fee)
3. Upload the zip → fill in description + screenshots → submit
4. Review takes ~3 days
5. Share the Web Store link with setters
