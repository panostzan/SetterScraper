importScripts('config.js');

const CONFIG = globalThis.SETTERSCRAPER_CONFIG;
if (!CONFIG) throw new Error('Missing config.js � copy config.example.js and fill in the integration values.');
const DB_BASE = CONFIG.documentApiBase;
const DB_QUERY = `${DB_BASE}:runQuery`;
const SCHEMA = CONFIG.schema;

// Column layout — matches the original internal sync tool exactly.
// Manual columns (B, H–L) are NEVER overwritten on existing rows.
const HEADERS = [
  'Client Name',        // A  0  — document database
  'Stage',              // B  1  — Manual (dropdown)
  'Phone',              // C  2  — document database
  'Email',              // D  3  — document database
  'Address',            // E  4  — document database
  'Consultation Date',  // F  5  — document database
  'PM / Closer',        // G  6  — document database
  'Notes',              // H  7  — Manual
  '3 Day',              // I  8  — Manual
  '7 Day',              // J  9  — Manual
  '2 Weeks',            // K  10 — Manual
  'Interest Level',     // L  11 — Manual
  'Time',               // M  12 — document database
  'CRM ID',         // N  13 — document database (hidden, used for dedup)
];

const STAGES = ['Unqualified', 'Qualified', 'Reschedule', 'Cancel', 'No Show', 'Dead', 'Closed Sale'];

const STAGE_COLORS = {
  'Closed Sale': { red: 0.784, green: 0.949, blue: 0.769 },
  'Qualified':   { red: 0.831, green: 0.914, blue: 1.0   },
  'Reschedule':  { red: 1.0,   green: 0.914, blue: 0.800 },
  'No Show':     { red: 0.980, green: 0.851, blue: 0.851 },
  'Cancel':      { red: 0.910, green: 0.910, blue: 0.910 },
  'Dead':        { red: 0.816, green: 0.816, blue: 0.816 },
  'Unqualified': { red: 0.949, green: 0.769, blue: 0.769 },
};

const NAVY = { red: 0.102, green: 0.102, blue: 0.180 };
const WHITE = { red: 1, green: 1, blue: 1 };


// ── JWT helpers ───────────────────────────────────────────────────

function getUserId(token) {
  try {
    const payload = token.split('.')[1];
    const padded  = payload + '='.repeat((4 - payload.length % 4) % 4);
    const data    = JSON.parse(atob(padded));
    return data.user_id || data.sub || '';
  } catch {
    return '';
  }
}


// ── document database field extractors ────────────────────────────────────

function fval(field = {}) {
  for (const k of ['stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'timestampValue']) {
    if (k in field) return String(field[k]);
  }
  return '';
}

function fmap(field = {}) {
  return field?.mapValue?.fields ?? {};
}

// Convert UTC ISO timestamp → [YYYY-MM-DD, H:MM AM/PM] in Eastern time.
function parseConsultation(dateStr) {
  if (!dateStr) return ['', ''];
  try {
    const dt    = new Date(dateStr);
    const parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(dt).forEach(p => { parts[p.type] = p.value; });
    return [
      `${parts.year}-${parts.month}-${parts.day}`,
      `${parts.hour}:${parts.minute} ${parts.dayPeriod ?? ''}`.trim(),
    ];
  } catch {
    return ['', ''];
  }
}

// Strip non-digits for phone number comparison (migration failsafe).
function digitsOnly(s) {
  return (s || '').replace(/\D/g, '');
}

// Fetch wrapper that converts network errors into readable messages.
async function safeFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch {
    throw new Error('No internet connection — check your network and try again');
  }
}


// ── document database API ─────────────────────────────────────────────────

async function fetchAllClients(fbToken, userId) {
  const headers = { 'Authorization': `Bearer ${fbToken}`, 'Content-Type': 'application/json' };
  const allDocs = [];
  let offset    = 0;

  // Paginate in batches of 200 (document database limit)
  while (true) {
    const r = await safeFetch(DB_QUERY, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from:  [{ collectionId: SCHEMA.collections.clients }],
          where: { fieldFilter: { field: { fieldPath: SCHEMA.fields.createdByUserId }, op: 'EQUAL', value: { stringValue: userId } } },
          limit: 200,
          offset,
          // No orderBy — combining where on one field + orderBy on another requires
          // a composite document database index that doesn't exist. Sort in JS after fetch.
        },
      }),
    });
    if (r.status === 401 || r.status === 403) {
      throw new Error('Your CRM session has expired — refresh your CRM and try again');
    }
    if (r.status === 429) {
      throw new Error('CRM is rate limiting — wait a moment and try again');
    }
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`document database error ${r.status}: ${body}`);
    }
    const data = await r.json();
    const docs = data.filter(d => d.document);
    allDocs.push(...docs);
    if (docs.length < 200) break;
    offset += 200;
  }

  // Sort newest-first in JS (can't use orderBy alongside where without a composite index)
  allDocs.sort((a, b) => {
    const at = fval(a.document.fields?.createdAt ?? {});
    const bt = fval(b.document.fields?.createdAt ?? {});
    return bt.localeCompare(at);
  });

  return allDocs;
}

async function fetchProject(fbToken, clientId) {
  try {
    const r = await fetch(`${DB_BASE}/${SCHEMA.collections.clients}/${clientId}/${SCHEMA.collections.projects}?pageSize=1`, {
      headers: { Authorization: `Bearer ${fbToken}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.documents?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchUserName(fbToken, userId) {
  try {
    const r = await fetch(`${DB_BASE}/${SCHEMA.collections.users}/${userId}`, {
      headers: { Authorization: `Bearer ${fbToken}` },
    });
    if (!r.ok) return '';
    return fval((await r.json()).fields?.[SCHEMA.fields.userName] ?? {});
  } catch {
    return '';
  }
}

// Fetch projects 10 at a time (limits concurrent project requests to batches of 10)
async function fetchAllProjects(fbToken, clientIds) {
  const results = [];
  for (let i = 0; i < clientIds.length; i += 10) {
    const batch = await Promise.all(
      clientIds.slice(i, i + 10).map(id => fetchProject(fbToken, id))
    );
    results.push(...batch);
  }
  return results;
}


// ── Build + filter client data ────────────────────────────────────

function buildClientData(clientDocs, projectDocs, nameCache) {
  const allData = [];

  for (let i = 0; i < clientDocs.length; i++) {
    const cf       = clientDocs[i].document.fields;
    const clientId = clientDocs[i].document.name.split('/').pop();
    const proj     = projectDocs[i];

    const name  = `${fval(cf[SCHEMA.fields.firstName] ?? {})} ${fval(cf[SCHEMA.fields.lastName] ?? {})}`.trim();
    const phone = fval(cf[SCHEMA.fields.phone] ?? {});
    const email = fval(cf[SCHEMA.fields.email] ?? {});

    let address = '', pm = '', consultationDate = '', consultationTime = '';

    if (proj) {
      const pf   = proj.fields ?? {};
      const addr = fmap(pf[SCHEMA.fields.address] ?? {});
      address = [
        fval(addr[SCHEMA.fields.street]     ?? {}),
        fval(addr[SCHEMA.fields.city]       ?? {}),
        fval(addr[SCHEMA.fields.province]   ?? {}),
        fval(addr[SCHEMA.fields.postalCode] ?? {}),
      ].filter(Boolean).join(', ');

      const consult = fmap(pf[SCHEMA.fields.consultation] ?? {});
      pm = nameCache.get(fval(consult[SCHEMA.fields.pmUserId] ?? {})) || '';

      const scheduledStart = fval(consult[SCHEMA.fields.scheduledStart] ?? {});
      if (scheduledStart) {
        // Confirmed appointment — UTC timestamp
        [consultationDate, consultationTime] = parseConsultation(scheduledStart);
      } else {
        // Intake phase — PM not yet assigned, date stored in preferences
        const prefs = fmap(consult[SCHEMA.fields.preferences] ?? {});
        consultationDate = fval(prefs[SCHEMA.fields.date] ?? {});
        const startTime  = fval(prefs[SCHEMA.fields.startTime] ?? {});
        if (consultationDate && startTime) {
          try {
            const [h, m] = startTime.split(':').map(Number);
            consultationTime = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
          } catch {
            consultationTime = startTime;
          }
        }
      }
    }

    allData.push({ clientId, name, phone, email, address, pm, consultationDate, consultationTime });
  }

  // Failsafe: skip clients with no identity (name/phone) or no consultation booked
  return allData.filter(d => (d.name || d.phone) && d.consultationDate);
}


// ── Google OAuth ──────────────────────────────────────────────────

async function getGoogleToken() {
  return new Promise((resolve, reject) => {
    // Try silently first — uses cached token, no popup needed
    chrome.identity.getAuthToken({ interactive: false }, token => {
      if (!chrome.runtime.lastError && token) { resolve(token); return; }
      // No cached token — show interactive popup
      chrome.identity.getAuthToken({ interactive: true }, token2 => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('not approve') || msg.toLowerCase().includes('denied')) {
            reject(new Error('Google sign-in was cancelled'));
          } else {
            reject(new Error(`Google sign-in failed — ${msg}`));
          }
        } else {
          resolve(token2);
        }
      });
    });
  });
}


// ── Sheets API helpers ────────────────────────────────────────────

async function sheetsReq(googleToken, method, path, body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await safeFetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, opts);
  if (!r.ok) {
    const text = await r.text();
    const err  = new Error(
      r.status === 429 ? 'Google Sheets is rate limiting — wait a moment and try again'
      : `Sheets API ${r.status}: ${text}`
    );
    err.status = r.status;
    throw err;
  }
  return r.json();
}


// ── Create spreadsheet (first run only) ──────────────────────────

async function getOrCreateSpreadsheet(googleToken, sendProgress) {
  const { spreadsheetId } = await chrome.storage.local.get('spreadsheetId');

  if (spreadsheetId) {
    try {
      sendProgress('Connecting to your sheet...', 63);
      await sheetsReq(googleToken, 'GET', `/${spreadsheetId}?fields=spreadsheetId`);
      return spreadsheetId;
    } catch {
      // Sheet was deleted — fall through and create a new one
    }
  }

  sendProgress('Creating your spreadsheet...', 63);
  const ss = await sheetsReq(googleToken, 'POST', '', {
    properties: { title: 'SetterScraper Pipeline' },
    sheets: [
      { properties: { title: 'Clients', index: 0 } },
      { properties: { title: 'Today',   index: 1 } },
      { properties: { title: 'Stats',   index: 2 } },
    ],
  });

  await chrome.storage.local.set({ spreadsheetId: ss.spreadsheetId });
  await setupSpreadsheet(googleToken, ss.spreadsheetId, sendProgress);
  return ss.spreadsheetId;
}

async function setupSpreadsheet(googleToken, spreadsheetId, sendProgress) {
  sendProgress('Setting up columns and dropdowns...', 67);
  const ss = await sheetsReq(googleToken, 'GET', `/${spreadsheetId}?fields=sheets.properties`);
  const clientsSheet = ss.sheets.find(s => s.properties.title === 'Clients');
  if (!clientsSheet) {
    // Clients tab was deleted — reset so the next sync creates a fresh sheet
    await chrome.storage.local.remove('spreadsheetId');
    throw new Error('The Clients tab was deleted from your sheet — a new sheet will be created on your next sync');
  }
  const cid = clientsSheet.properties.sheetId;

  // Widths match the original internal sync tool.gs: A–G same, then Notes/manual cols, Time, hidden ID
  const colWidths = [185, 165, 125, 185, 245, 135, 145, 210, 65, 65, 75, 130, 90, 80];

  const requests = [
    // Freeze header row
    {
      updateSheetProperties: {
        properties: { sheetId: cid, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Header row style (navy bg, white bold text)
    {
      repeatCell: {
        range: { sheetId: cid, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: NAVY,
            textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Hide CRM ID column (N = index 13)
    {
      updateDimensionProperties: {
        range: { sheetId: cid, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    },
    // Column widths
    ...colWidths.map((pixelSize, i) => ({
      updateDimensionProperties: {
        range: { sheetId: cid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize },
        fields: 'pixelSize',
      },
    })),
    // Stage dropdown (col B = index 1)
    {
      setDataValidation: {
        range: { sheetId: cid, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 1, endColumnIndex: 2 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: STAGES.map(v => ({ userEnteredValue: v })) },
          showCustomUi: true,
          strict: true,
        },
      },
    },
    // ✓/✗ checkboxes for 3 Day / 7 Day / 2 Weeks (cols I–K = index 8–10)
    {
      setDataValidation: {
        range: { sheetId: cid, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 8, endColumnIndex: 11 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: '✓' }, { userEnteredValue: '✗' }] },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Interest Level dropdown (col L = index 11)
    {
      setDataValidation: {
        range: { sheetId: cid, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 11, endColumnIndex: 12 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: ['🔥 Hot', '👍 Warm', '❄️ Cold', '❓ Unknown'].map(v => ({ userEnteredValue: v })),
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Stage conditional formatting (col B)
    ...Object.entries(STAGE_COLORS).map(([stage, color], idx) => ({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: cid, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 1, endColumnIndex: 2 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: stage }] },
            format: { backgroundColor: color },
          },
        },
        index: idx,
      },
    })),
  ];

  await sheetsReq(googleToken, 'POST', `/${spreadsheetId}:batchUpdate`, { requests });

  sendProgress('Writing headers and formulas...', 72);
  await Promise.all([
    sheetsReq(googleToken, 'PUT',
      `/${spreadsheetId}/values/Clients!A1:N1?valueInputOption=RAW`,
      { values: [HEADERS] }
    ),
    // Today tab: today's sits (left) + follow-ups due (right)
    sheetsReq(googleToken, 'PUT',
      `/${spreadsheetId}/values/Today!A1:F3?valueInputOption=USER_ENTERED`,
      { values: [
        ["TODAY'S SITS", '', '', 'FOLLOW-UPS DUE TODAY', '', ''],
        ['Client Name', 'PM / Closer', '', 'Client Name', 'PM / Closer', 'Consult Date'],
        [
          '=IFERROR(FILTER({Clients!A:A,Clients!G:G},Clients!F:F=TEXT(TODAY(),"YYYY-MM-DD")),"No consultations today")',
          '', '',
          '=IFERROR(FILTER({Clients!A:A,Clients!G:G,Clients!F:F},(Clients!F:F=TEXT(TODAY()-3,"YYYY-MM-DD"))+(Clients!F:F=TEXT(TODAY()-7,"YYYY-MM-DD"))+(Clients!F:F=TEXT(TODAY()-14,"YYYY-MM-DD"))),"No follow-ups due")',
          '', '',
        ],
      ]}
    ),
    // Stats tab
    sheetsReq(googleToken, 'PUT',
      `/${spreadsheetId}/values/Stats!A1:D6?valueInputOption=USER_ENTERED`,
      { values: [
        ['SETTERSCRAPER STATS', '', '', ''],
        ['', '', '', ''],
        ['Total Clients',     '=COUNTA(Clients!A:A)-1',
         'Closed Sales',      '=COUNTIF(Clients!B:B,"Closed Sale")'],
        ['Total Sits',        '=COUNTIF(Clients!B:B,"No Show")+COUNTIF(Clients!B:B,"Closed Sale")',
         'Close Rate',        '=IFERROR(TEXT(COUNTIF(Clients!B:B,"Closed Sale")/(COUNTA(Clients!A:A)-1),"0.0%"),"0%")'],
        ['Closes This Month', '=COUNTIFS(Clients!B:B,"Closed Sale",Clients!F:F,">="&TEXT(DATE(YEAR(TODAY()),MONTH(TODAY()),1),"YYYY-MM-DD"))',
         'Sit Rate',          '=IFERROR(TEXT((COUNTIF(Clients!B:B,"No Show")+COUNTIF(Clients!B:B,"Closed Sale"))/(COUNTA(Clients!A:A)-1),"0.0%"),"0%")'],
        ['PM Breakdown',      '=IFERROR(QUERY(Clients!G2:G500,"SELECT G, COUNT(G) WHERE G <> \'\' GROUP BY G ORDER BY COUNT(G) DESC LABEL G \'PM\', COUNT(G) \'Clients\'",0),"No data")',
         '', ''],
      ]}
    ),
  ]);
}


// ── Write clients to sheet ────────────────────────────────────────

async function writeClients(googleToken, spreadsheetId, allData, sendProgress) {
  sendProgress('Checking for existing rows...', 78);
  const existing   = await sheetsReq(googleToken, 'GET', `/${spreadsheetId}/values/Clients!N:N`);
  const idValues   = (existing.values ?? []).slice(1).map(r => r[0] ?? '');
  const rowById    = {};
  idValues.forEach((id, i) => { if (id) rowById[id] = i + 2; }); // +2: 1-indexed + skip header

  // Failsafe: migration for rows that exist but have no ID yet.
  // Match by name (exact, case-insensitive) or phone (digits only).
  // Runs on every sync until every row has an ID — then becomes a no-op.
  const rowsWithoutId = idValues.map((id, i) => (!id ? i + 2 : null)).filter(Boolean);
  if (rowsWithoutId.length) {
    const [nameCol, phoneCol] = await Promise.all([
      sheetsReq(googleToken, 'GET', `/${spreadsheetId}/values/Clients!A:A`),
      sheetsReq(googleToken, 'GET', `/${spreadsheetId}/values/Clients!C:C`),
    ]);
    const existingNames  = (nameCol.values  ?? []).slice(1).map(r => r[0] ?? '');
    const existingPhones = (phoneCol.values ?? []).slice(1).map(r => r[0] ?? '');

    const nameToRow  = {};
    const phoneToRow = {};
    rowsWithoutId.forEach(row => {
      const i = row - 2;
      if (existingNames[i])  nameToRow[existingNames[i].toLowerCase()]  = row;
      if (existingPhones[i]) phoneToRow[digitsOnly(existingPhones[i])]  = row;
    });

    const idBackfill = [];
    for (const d of allData) {
      if (rowById[d.clientId]) continue;
      const row = nameToRow[d.name.toLowerCase()] ?? phoneToRow[digitsOnly(d.phone)];
      if (row) {
        rowById[d.clientId] = row;
        idBackfill.push({ range: `Clients!N${row}`, values: [[d.clientId]] });
      }
    }
    if (idBackfill.length) {
      sendProgress(`Backfilling IDs for ${idBackfill.length} existing rows...`, 82);
      await sheetsReq(googleToken, 'POST', `/${spreadsheetId}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: idBackfill,
      });
    }
  }

  // Separate into existing (update) and new (append)
  const toUpdate = allData.filter(d =>  rowById[d.clientId]);
  const toAppend = allData.filter(d => !rowById[d.clientId]);

  // Sort new clients: soonest consultation date first
  toAppend.sort((a, b) => a.consultationDate.localeCompare(b.consultationDate));

  // nextRow = first empty row after all existing data rows (header is row 1, data starts at row 2)
  let nextRow = idValues.length + 2;
  const updates = [];

  // Existing rows — only update document database-sourced columns.
  // Never touch B (Stage), H–L (Notes, checkboxes, Interest Level).
  for (const d of toUpdate) {
    const row = rowById[d.clientId];
    updates.push(
      { range: `Clients!A${row}`,         values: [[d.name]] },
      { range: `Clients!C${row}:G${row}`, values: [[d.phone, d.email, d.address, d.consultationDate, d.pm]] },
      { range: `Clients!M${row}`,         values: [[d.consultationTime]] },
      { range: `Clients!N${row}`,         values: [[d.clientId]] },
    );
  }

  // New rows — default Stage "Unqualified", manual columns (H–L) left blank
  for (const d of toAppend) {
    updates.push({
      range: `Clients!A${nextRow}:N${nextRow}`,
      values: [[
        d.name, 'Unqualified', d.phone, d.email, d.address,
        d.consultationDate, d.pm,
        '', '', '', '', '',  // H–L: Notes, 3 Day, 7 Day, 2 Weeks, Interest Level
        d.consultationTime,  // M: Time
        d.clientId,          // N: CRM ID (hidden)
      ]],
    });
    nextRow++;
  }

  if (updates.length) {
    if (toUpdate.length && toAppend.length) {
      sendProgress(`Updating ${toUpdate.length} existing + writing ${toAppend.length} new clients...`, 88);
    } else if (toAppend.length) {
      sendProgress(`Writing ${toAppend.length} new clients...`, 88);
    } else {
      sendProgress(`Updating ${toUpdate.length} existing clients...`, 88);
    }
    await sheetsReq(googleToken, 'POST', `/${spreadsheetId}/values:batchUpdate`, {
      valueInputOption: 'RAW',
      data: updates,
    });
  }

  sendProgress('Saving sync state...', 96);
  // Persist seen IDs so new-client detection works across sessions
  const { seenIds = [] } = await chrome.storage.local.get('seenIds');
  const allSeenIds = [...new Set([...seenIds, ...allData.map(d => d.clientId)])];
  await chrome.storage.local.set({ seenIds: allSeenIds });

  return { total: allData.length, newCount: toAppend.length };
}


// ── Main sync ─────────────────────────────────────────────────────

async function doSync(sendProgress) {
  sendProgress('Connecting to CRM...', 5);
  const tabs = await chrome.tabs.query({ url: `${CONFIG.crmOrigin}/*` });
  if (!tabs.length) throw new Error('Open your CRM and log in, then click Sync');

  // Inject token extraction directly into the tab on demand.
  let tokenResult;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => new Promise(resolve => {
        const req = indexedDB.open(CONFIG.auth.databaseName);
        req.onerror = () => resolve({ error: 'indexeddb_error' });
        req.onsuccess = e => {
          const db = e.target.result;
          const tx = db.transaction(CONFIG.auth.storeName, 'readonly');
          const all = tx.objectStore(CONFIG.auth.storeName).getAll();
          all.onsuccess = () => {
            const entry = all.result.find(i => i.value?.stsTokenManager);
            resolve(entry
              ? { token: entry.value.stsTokenManager.accessToken }
              : { error: 'not_logged_in' }
            );
          };
          all.onerror = () => resolve({ error: 'indexeddb_read_error' });
        };
      }),
    });
    tokenResult = result;
  } catch {
    throw new Error('your CRM is still loading — wait for it to finish and try again');
  }

  if (tokenResult.error === 'not_logged_in') throw new Error('Log in to CRM first');
  if (tokenResult.error) throw new Error(`CRM session error: ${tokenResult.error}`);

  const fbToken = tokenResult.token;
  const userId  = getUserId(fbToken);
  if (!userId) throw new Error('Could not read your CRM user ID');

  sendProgress('Fetching your clients...', 15);
  const clientDocs = await fetchAllClients(fbToken, userId);
  if (!clientDocs.length) throw new Error('No clients found in your CRM account');

  sendProgress(`${clientDocs.length} clients found — loading details...`, 30);
  const clientIds   = clientDocs.map(d => d.document.name.split('/').pop());
  const projectDocs = await fetchAllProjects(fbToken, clientIds);

  // Resolve unique PM IDs → names (one request per unique PM, not per client)
  const pmIds = new Set();
  projectDocs.forEach(proj => {
    if (proj) {
      const uid = fval(fmap(proj.fields?.consultation ?? {}).pmUserId ?? {});
      if (uid) pmIds.add(uid);
    }
  });
  sendProgress(`Resolving ${pmIds.size} PM names...`, 48);
  const nameEntries = await Promise.all([...pmIds].map(async uid => [uid, await fetchUserName(fbToken, uid)]));
  const nameCache   = new Map(nameEntries);

  sendProgress('Processing client data...', 55);
  const allData = buildClientData(clientDocs, projectDocs, nameCache);
  if (!allData.length) throw new Error('No clients with consultation dates found — nothing to sync');
  sendProgress(`${allData.length} clients ready — signing in to Google...`, 60);

  let googleToken = await getGoogleToken();

  const runGoogleOps = async (token) => {
    const spreadsheetId = await getOrCreateSpreadsheet(token, sendProgress);
    const { total, newCount } = await writeClients(token, spreadsheetId, allData, sendProgress);
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    await chrome.storage.local.set({ lastSync: Date.now(), sheetUrl });
    return { total, newCount, sheetUrl };
  };

  try {
    return await runGoogleOps(googleToken);
  } catch (err) {
    if (err.status === 401) {
      // Token expired — clear it and get a fresh one, then retry once
      sendProgress('Session expired — re-authenticating...', 60);
      await new Promise(r => chrome.identity.removeCachedAuthToken({ token: googleToken }, r));
      googleToken = await getGoogleToken();
      return await runGoogleOps(googleToken);
    }
    throw err;
  }
}


// ── Message listener ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SYNC') return;

  doSync((progressMsg, pct) => {
    chrome.runtime.sendMessage({ type: 'PROGRESS', msg: progressMsg, pct }).catch(() => {});
  })
    .then(result => sendResponse({ ok: true,  ...result }))
    .catch(err   => sendResponse({ ok: false, error: err.message }));

  return true;
});
