chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_BOOKMARK_TREE") {
    chrome.bookmarks.getTree().then((tree) => {
      sendResponse({ ok: true, tree });
    });
    return true; // async
  }
});
