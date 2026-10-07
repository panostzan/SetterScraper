const progressRow = document.getElementById('progress-row');
const idleRow     = document.getElementById('idle-row');
const dotIdle     = document.getElementById('dot-idle');
const statusIdle  = document.getElementById('status-idle');
const progressFill = document.getElementById('progress-fill');
const progressPct  = document.getElementById('progress-pct');
const statusEl    = document.getElementById('status');
const btnSync     = document.getElementById('btn-sync');
const sheetLink   = document.getElementById('sheet-link');
const statsEl     = document.getElementById('stats');
const statTotal   = document.getElementById('stat-total');
const statNew     = document.getElementById('stat-new');
const footerEl    = document.getElementById('footer');

function setProgress(pct) {
  progressFill.style.width = pct + '%';
  progressPct.textContent  = pct + '%';
}

function setSyncing(msg, pct) {
  progressRow.style.display = 'flex';
  idleRow.style.display     = 'none';
  statusEl.textContent      = msg;
  setProgress(pct);
}

function setIdle(dotClass, msg) {
  progressRow.style.display = 'none';
  idleRow.style.display     = 'flex';
  statusEl.textContent      = '';
  dotIdle.className         = `dot ${dotClass}`;
  statusIdle.textContent    = msg;
  setProgress(0);
}

function formatTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'Last synced just now';
  if (diff < 3_600_000) return `Last synced ${Math.floor(diff / 60_000)}m ago`;
  return `Last synced at ${new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

async function init() {
  const { lastSync, sheetUrl, lastTotal, lastNew } = await chrome.storage.local.get([
    'lastSync', 'sheetUrl', 'lastTotal', 'lastNew',
  ]);

  if (sheetUrl) {
    sheetLink.href          = sheetUrl;
    sheetLink.style.display = 'flex';
  }
  if (lastTotal != null) {
    statTotal.textContent   = lastTotal;
    statNew.textContent     = lastNew ?? 0;
    statsEl.style.display   = 'flex';
  }
  if (lastSync) {
    footerEl.textContent    = formatTime(lastSync);
    setIdle('done', `${lastTotal ?? '?'} clients synced.`);
  } else {
    setIdle('', 'Ready — open nuvohub.ca then click Sync.');
  }
}

btnSync.addEventListener('click', async () => {
  btnSync.disabled        = true;
  sheetLink.style.display = 'none';
  statsEl.style.display   = 'none';
  setSyncing('Starting...', 0);

  const onProgress = (msg) => {
    if (msg.type === 'PROGRESS') setSyncing(msg.msg, msg.pct);
  };
  chrome.runtime.onMessage.addListener(onProgress);

  const result = await chrome.runtime.sendMessage({ type: 'SYNC' });
  chrome.runtime.onMessage.removeListener(onProgress);

  if (result.ok) {
    setProgress(100);
    setTimeout(() => {
      setIdle('done', `Done — ${result.total} clients synced${result.newCount ? `, ${result.newCount} new` : ''}.`);
    }, 600);

    sheetLink.href          = result.sheetUrl;
    sheetLink.style.display = 'flex';
    statTotal.textContent   = result.total;
    statNew.textContent     = result.newCount;
    statsEl.style.display   = 'flex';
    footerEl.textContent    = formatTime(Date.now());
    await chrome.storage.local.set({ lastTotal: result.total, lastNew: result.newCount });
  } else {
    setIdle('error', result.error || 'Something went wrong.');
  }

  btnSync.disabled = false;
});

init();
