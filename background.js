chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_BOOKMARK_TREE") {
    chrome.bookmarks.getTree().then((tree) => sendResponse({ ok: true, tree }));
    return true;
  }

  if (msg?.type === "GET_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const t = tabs?.[0];
      if (!t) return sendResponse({ ok: false });
      sendResponse({
        ok: true,
        tab: { url: t.url || "", title: t.title || "" }
      });
    });
    return true;
  }

  if (msg?.type === "OPEN_IN_NEW_WINDOW") {
    const url = (msg?.url || "").trim();
    if (!url) {
      sendResponse({ ok: false, error: "Empty URL" });
      return;
    }
    chrome.windows.create({ url }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true });
      }
    });
    return true;
  }
});
