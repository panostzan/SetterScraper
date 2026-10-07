// Runs on nuvohub.ca — extracts Firebase auth token from IndexedDB.
// The user is already logged in here, so the token is always present.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'GET_TOKEN') return;

  const req = indexedDB.open('firebaseLocalStorageDb');

  req.onerror = () => sendResponse({ error: 'indexeddb_error' });

  req.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('firebaseLocalStorage', 'readonly');
    const store = tx.objectStore('firebaseLocalStorage');
    const all = store.getAll();

    all.onsuccess = () => {
      const entry = all.result.find(i => i.value?.stsTokenManager);
      if (entry) {
        sendResponse({ token: entry.value.stsTokenManager.accessToken });
      } else {
        sendResponse({ error: 'not_logged_in' });
      }
    };

    all.onerror = () => sendResponse({ error: 'indexeddb_read_error' });
  };

  return true; // keep message channel open for async response
});
