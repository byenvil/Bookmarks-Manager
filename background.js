const TRASH_KEY = "pbm_trash";
const TRASH_MAX = 100;

const NOTES_KEY = "pbm_notes";
const NOTES_MAX = 500;

async function getTrash() {
  const obj = await chrome.storage.local.get(TRASH_KEY);
  const arr = obj?.[TRASH_KEY];
  return Array.isArray(arr) ? arr : [];
}

async function setTrash(arr) {
  const trimmed = arr.slice(0, TRASH_MAX);
  await chrome.storage.local.set({ [TRASH_KEY]: trimmed });
}

async function pushTrash(item) {
  const trash = await getTrash();
  trash.unshift(item);
  await setTrash(trash);
}

async function getNotes() {
  const obj = await chrome.storage.local.get(NOTES_KEY);
  const arr = obj?.[NOTES_KEY];
  return Array.isArray(arr) ? arr : [];
}

async function setNotes(arr) {
  await chrome.storage.local.set({ [NOTES_KEY]: arr.slice(0, NOTES_MAX) });
}

function uid() {
  return (crypto.randomUUID?.() || String(Date.now()) + Math.random());
}

async function removeTreeOrNode(id, isFolder) {
  if (isFolder) {
    await chrome.bookmarks.removeTree(id);
  } else {
    await chrome.bookmarks.remove(id);
  }
}

async function createFromSubtree(parentId, node, index) {
  const created = await chrome.bookmarks.create({
    parentId,
    index: typeof index === "number" ? index : undefined,
    title: node.title || "",
    url: node.url
  });

  if (Array.isArray(node.children) && node.children.length) {
    for (const child of node.children) {
      await createFromSubtree(created.id, child);
    }
  }
  return created;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "GET_BOOKMARK_TREE") {
        const tree = await chrome.bookmarks.getTree();
        sendResponse({ ok: true, tree });
        return;
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
        return;
      }

      if (msg?.type === "OPEN_IN_NEW_WINDOW") {
        const url = (msg?.url || "").trim();
        if (!url) return sendResponse({ ok: false, error: "Empty URL" });

        chrome.windows.create({ url }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true });
          }
        });
        return;
      }

      if (msg?.type === "CREATE_FOLDER") {
        const title = (msg?.title || "").trim();
        const parentId = msg?.parentId;
        if (!title) return sendResponse({ ok: false, error: "Empty title" });

        const created = await chrome.bookmarks.create({
          parentId: parentId || undefined,
          title
        });
        sendResponse({ ok: true, created });
        return;
      }

      if (msg?.type === "CREATE_BOOKMARK") {
        const url = (msg?.url || "").trim();
        let title = (msg?.title || "").trim();
        const parentId = msg?.parentId;

        if (!url) return sendResponse({ ok: false, error: "Empty url" });
        if (!title) title = url;

        const created = await chrome.bookmarks.create({
          parentId: parentId || undefined,
          title,
          url
        });
        sendResponse({ ok: true, created });
        return;
      }

      if (msg?.type === "DELETE_NODE") {
        const id = msg?.id;
        if (!id) return sendResponse({ ok: false, error: "No id" });

        const [node] = await chrome.bookmarks.get(id);
        if (!node) return sendResponse({ ok: false, error: "Not found" });

        const isFolder = !node.url;
        const parentId = node.parentId || null;
        const index = typeof node.index === "number" ? node.index : null;

        let subtree = null;
        if (isFolder) {
          const sub = await chrome.bookmarks.getSubTree(id);
          subtree = sub?.[0] || null;
        } else {
          subtree = node;
        }

        if (!subtree) return sendResponse({ ok: false, error: "No subtree" });

        await pushTrash({
          trashId: uid(),
          deletedAt: Date.now(),
          parentId,
          index,
          subtree
        });

        await removeTreeOrNode(id, isFolder);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "RESTORE_LAST_DELETED") {
        const trash = await getTrash();
        const item = trash[0];
        if (!item) return sendResponse({ ok: false, error: "Trash empty" });

        let safeParentId = item.parentId || undefined;
        if (safeParentId) {
          try {
            const p = await chrome.bookmarks.get(safeParentId);
            if (!p?.length) safeParentId = undefined;
          } catch {
            safeParentId = undefined;
          }
        }

        const created = await createFromSubtree(safeParentId, item.subtree, item.index ?? undefined);

        trash.shift();
        await setTrash(trash);

        sendResponse({ ok: true, created });
        return;
      }

      // ---------- NOTES CRUD ----------
      if (msg?.type === "NOTES_LIST") {
        const notes = await getNotes();
        sendResponse({ ok: true, notes });
        return;
      }

      if (msg?.type === "NOTES_CREATE") {
        const title = (msg?.title || "").trim() || "Без названия";
        const content = (msg?.content || "");
        const now = Date.now();

        const notes = await getNotes();
        const note = { id: uid(), title, content, createdAt: now, updatedAt: now };
        notes.unshift(note);
        await setNotes(notes);

        sendResponse({ ok: true, note });
        return;
      }

      if (msg?.type === "NOTES_UPDATE") {
        const id = msg?.id;
        if (!id) return sendResponse({ ok: false, error: "No id" });

        const title = (msg?.title || "").trim() || "Без названия";
        const content = (msg?.content || "");
        const now = Date.now();

        const notes = await getNotes();
        const idx = notes.findIndex((n) => n.id === id);
        if (idx === -1) return sendResponse({ ok: false, error: "Not found" });

        notes[idx] = { ...notes[idx], title, content, updatedAt: now };
        await setNotes(notes);

        sendResponse({ ok: true, note: notes[idx] });
        return;
      }

      if (msg?.type === "NOTES_DELETE") {
        const id = msg?.id;
        if (!id) return sendResponse({ ok: false, error: "No id" });

        const notes = await getNotes();
        const idx = notes.findIndex((n) => n.id === id);
        if (idx === -1) return sendResponse({ ok: false, error: "Not found" });

        const [removed] = notes.splice(idx, 1);
        await setNotes(notes);

        sendResponse({ ok: true, removed });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
