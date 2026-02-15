(() => {
  if (window.__pbmInjected) return;
  window.__pbmInjected = true;

  // ---------------- UI ----------------
  const handle = document.createElement("div");
  handle.id = "pbm-handle";

  const sidebar = document.createElement("div");
  sidebar.id = "pbm-sidebar";

  const header = document.createElement("div");
  header.id = "pbm-header";

  const row1 = document.createElement("div");
  row1.id = "pbm-row1";

  const search = document.createElement("input");
  search.id = "pbm-search";
  search.type = "text";
  search.placeholder = "Поиск закладок…";

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "pbm-btn";
  collapseBtn.type = "button";
  collapseBtn.textContent = "Свернуть все";

  row1.appendChild(search);
  row1.appendChild(collapseBtn);

  const row2 = document.createElement("div");
  row2.id = "pbm-row2";

  const createFolderBtn = document.createElement("button");
  createFolderBtn.className = "pbm-btn";
  createFolderBtn.type = "button";
  createFolderBtn.textContent = "Создать папку";

  const addBookmarkBtn = document.createElement("button");
  addBookmarkBtn.className = "pbm-btn pbm-btn-primary";
  addBookmarkBtn.type = "button";
  addBookmarkBtn.textContent = "Добавить закладку";

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "pbm-btn";
  restoreBtn.type = "button";
  restoreBtn.textContent = "Восстановить";

  row2.appendChild(createFolderBtn);
  row2.appendChild(addBookmarkBtn);
  row2.appendChild(restoreBtn);

  const content = document.createElement("div");
  content.id = "pbm-content";

  header.appendChild(row1);
  header.appendChild(row2);
  sidebar.appendChild(header);
  sidebar.appendChild(content);

  // Modal overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.id = "pbm-modal-overlay";

  const modal = document.createElement("div");
  modal.id = "pbm-modal";

  const modalTitle = document.createElement("div");
  modalTitle.id = "pbm-modal-title";

  const modalBody = document.createElement("div");
  const modalActions = document.createElement("div");
  modalActions.id = "pbm-modal-actions";

  const modalCancel = document.createElement("button");
  modalCancel.className = "pbm-btn";
  modalCancel.type = "button";
  modalCancel.textContent = "Отмена";

  const modalOk = document.createElement("button");
  modalOk.className = "pbm-btn pbm-btn-primary";
  modalOk.type = "button";
  modalOk.textContent = "OK";

  modalActions.appendChild(modalCancel);
  modalActions.appendChild(modalOk);

  modal.appendChild(modalTitle);
  modal.appendChild(modalBody);
  modal.appendChild(modalActions);
  modalOverlay.appendChild(modal);

  document.documentElement.appendChild(handle);
  document.documentElement.appendChild(sidebar);
  document.documentElement.appendChild(modalOverlay);

  // ---------------- State ----------------
  let isOpen = false;
  let originalNodes = [];
  let folderOptions = [];
  let lastRenderQuery = "";
  let debounceTimer = null;

  // ---------------- Helpers ----------------
  function toggle(open = !isOpen) {
    isOpen = open;
    handle.classList.toggle("pbm-open", isOpen);
    sidebar.classList.toggle("pbm-open", isOpen);
  }

  function debounce(fn, ms) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, ms);
  }

  function isFolder(node) {
    return Array.isArray(node.children);
  }

  // фавиконки (оставляем как было у тебя)
  function faviconForUrl(url) {
    try {
      const u = new URL(url);
      return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(u.origin)}`;
    } catch {
      return "";
    }
  }

  function openModal(title, bodyNode, okText = "OK", cancelText = "Отмена") {
    modalTitle.textContent = title;
    modalBody.innerHTML = "";
    modalBody.appendChild(bodyNode);
    modalOk.textContent = okText;
    modalCancel.textContent = cancelText;
    modalOverlay.style.display = "flex";
  }

  function closeModal() {
    modalOverlay.style.display = "none";
    modalBody.innerHTML = "";
    document.querySelectorAll(".pbm-dd-menu.pbm-open").forEach((m) => m.classList.remove("pbm-open"));
    // сброс обработчиков
    modalOk.onclick = null;
    modalCancel.onclick = null;
  }

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  function confirmDelete(name, onYes) {
    const body = document.createElement("div");
    body.style.fontSize = "13px";
    body.style.opacity = "0.92";
    body.style.lineHeight = "1.35";
    body.textContent = `Вы уверены что хотите удалить "${name}"?`;

    openModal("Подтверждение", body, "Да", "Нет");

    modalOk.onclick = async () => {
      await onYes();
      closeModal();
    };
    modalCancel.onclick = () => closeModal();
  }

  // ---------------- Bookmarks load ----------------
  async function loadBookmarks() {
    const res = await chrome.runtime.sendMessage({ type: "GET_BOOKMARK_TREE" });
    if (!res?.ok) return;

    const root = res.tree?.[0];
    const nodes = root?.children ?? [];
    originalNodes = nodes.flatMap((n) => n.children ?? []);

    folderOptions = buildFolderOptions(originalNodes);
    renderTree(originalNodes, lastRenderQuery);
  }

  function buildFolderOptions(nodes) {
    const out = [];
    const walk = (node, path) => {
      if (!isFolder(node)) return;
      const title = node.title || "Без названия";
      const newPath = path ? `${path} / ${title}` : title;
      out.push({ id: node.id, titlePath: newPath });
      (node.children || []).forEach((ch) => walk(ch, newPath));
    };
    nodes.forEach((n) => walk(n, ""));
    out.sort((a, b) => a.titlePath.localeCompare(b.titlePath, "ru"));
    return out;
  }

  // ---------------- Filtering ----------------
  function filterTree(nodes, q) {
    const query = q.trim().toLowerCase();
    if (!query) return nodes;

    const matches = (s) => (s || "").toLowerCase().includes(query);

    const walk = (node) => {
      if (isFolder(node)) {
        const kids = (node.children || []).map(walk).filter(Boolean);
        const folderMatches = matches(node.title);
        if (folderMatches || kids.length > 0) {
          return { ...node, children: kids, __pbmAutoExpand: true };
        }
        return null;
      } else {
        const ok = matches(node.title) || matches(node.url);
        return ok ? node : null;
      }
    };

    return nodes.map(walk).filter(Boolean);
  }

  // ---------------- Render ----------------
  function renderTree(nodes, query) {
    lastRenderQuery = query || "";
    const filtered = filterTree(nodes, lastRenderQuery);

    content.textContent = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "pbm-empty";
      empty.textContent = "Ничего не найдено.";
      content.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach((node) => frag.appendChild(renderNode(node, !!lastRenderQuery.trim())));
    content.appendChild(frag);
  }

  function makeDeleteBtn(label, onClick) {
    const del = document.createElement("div");
    del.className = "pbm-del";
    del.title = "Удалить";
    del.textContent = "×";

    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    // чтоб middle-click по кресту не открывал окно
    del.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return del;
  }

  function renderNode(node, forceExpand) {
    if (isFolder(node)) {
      const wrap = document.createElement("div");

      const row = document.createElement("div");
      row.className = "pbm-item pbm-folder-row";

      const left = document.createElement("div");
      left.className = "pbm-left";

      const icon = document.createElement("div");
      icon.className = "pbm-favicon";
      icon.textContent = "📁";
      icon.style.display = "flex";
      icon.style.alignItems = "center";
      icon.style.justifyContent = "center";
      icon.style.fontSize = "12px";

      const title = document.createElement("div");
      title.className = "pbm-title pbm-folder";
      title.textContent = node.title || "Без названия";

      left.appendChild(icon);
      left.appendChild(title);

      const del = makeDeleteBtn(node.title || "Без названия", async () => {
        confirmDelete(node.title || "Без названия", async () => {
          await chrome.runtime.sendMessage({ type: "DELETE_NODE", id: node.id });
          await loadBookmarks();
        });
      });

      row.appendChild(left);
      row.appendChild(del);

      const children = document.createElement("div");
      children.className = "pbm-children";

      const kids = node.children || [];
      const frag = document.createDocumentFragment();
      for (const ch of kids) frag.appendChild(renderNode(ch, forceExpand));
      children.appendChild(frag);

      if (forceExpand || node.__pbmAutoExpand) row.classList.add("pbm-expanded");

      row.addEventListener("click", () => row.classList.toggle("pbm-expanded"));

      wrap.appendChild(row);
      wrap.appendChild(children);
      return wrap;
    }

    // bookmark leaf
    const row = document.createElement("div");
    row.className = "pbm-item";
    row.dataset.url = node.url || "";

    const left = document.createElement("div");
    left.className = "pbm-left";

    const ico = document.createElement("img");
    ico.className = "pbm-favicon";
    ico.alt = "";
    ico.loading = "lazy";
    ico.referrerPolicy = "no-referrer";

    const primary = node.url ? faviconForUrl(node.url) : "";
    ico.src = primary;

    ico.onerror = () => {
      ico.onerror = null;
      try {
        const u = new URL(node.url);
        ico.src = `${u.origin}/favicon.ico`;
      } catch {}
    };

    const title = document.createElement("div");
    title.className = "pbm-title";
    title.textContent = node.title || node.url || "Закладка";

    left.appendChild(ico);
    left.appendChild(title);

    const del = makeDeleteBtn(node.title || node.url || "Закладка", async () => {
      confirmDelete(node.title || node.url || "Закладка", async () => {
        await chrome.runtime.sendMessage({ type: "DELETE_NODE", id: node.id });
        await loadBookmarks();
      });
    });

    row.appendChild(left);
    row.appendChild(del);

    row.addEventListener("click", () => {
      const url = row.dataset.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });

    // middle click -> new window
    row.addEventListener("auxclick", async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      const url = row.dataset.url;
      if (!url) return;
      await chrome.runtime.sendMessage({ type: "OPEN_IN_NEW_WINDOW", url });
    });

    row.addEventListener("mousedown", async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      const url = row.dataset.url;
      if (!url) return;
      await chrome.runtime.sendMessage({ type: "OPEN_IN_NEW_WINDOW", url });
    });

    return row;
  }

  // ---------------- Events ----------------
  handle.addEventListener("click", () => toggle());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) toggle(false);
    if (e.key === "Escape" && modalOverlay.style.display === "flex") closeModal();
  });

  collapseBtn.addEventListener("click", () => {
    sidebar.querySelectorAll(".pbm-folder-row.pbm-expanded").forEach((el) => el.classList.remove("pbm-expanded"));
  });

  search.addEventListener("input", () => {
    const q = search.value || "";
    debounce(() => requestAnimationFrame(() => renderTree(originalNodes, q)), 120);
  });

  // ---------------- Custom dropdown ----------------
  function folderDropdown({ allowNone }) {
    let selectedId = "";
    let selectedLabel = allowNone ? "Без папки (в корень)" : "Выберите папку";

    const wrap = document.createElement("div");
    wrap.className = "pbm-dd";

    const btn = document.createElement("div");
    btn.className = "pbm-dd-btn";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = selectedLabel;
    const caret = document.createElement("span");
    caret.className = "pbm-dd-caret";
    caret.textContent = "▾";
    btn.appendChild(labelSpan);
    btn.appendChild(caret);

    const menu = document.createElement("div");
    menu.className = "pbm-dd-menu";

    const addItem = (id, text, dim = false) => {
      const it = document.createElement("div");
      it.className = "pbm-dd-item" + (dim ? " pbm-dd-dim" : "");
      it.textContent = text;
      it.addEventListener("click", () => {
        selectedId = id;
        selectedLabel = text;
        labelSpan.textContent = selectedLabel;
        menu.classList.remove("pbm-open");
      });
      menu.appendChild(it);
    };

    if (allowNone) addItem("", "Без папки (в корень)", true);
    for (const f of folderOptions) addItem(f.id, f.titlePath);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".pbm-dd-menu.pbm-open").forEach((m) => {
        if (m !== menu) m.classList.remove("pbm-open");
      });
      menu.classList.toggle("pbm-open");
    });

    const onDocClick = (e) => {
      if (!wrap.contains(e.target)) menu.classList.remove("pbm-open");
    };
    document.addEventListener("click", onDocClick);

    wrap.appendChild(btn);
    wrap.appendChild(menu);

    return {
      wrap,
      get value() {
        return selectedId;
      },
      destroy() {
        document.removeEventListener("click", onDocClick);
      }
    };
  }

  function field(labelText, controlNode) {
    const wrap = document.createElement("div");
    wrap.className = "pbm-field";
    const label = document.createElement("div");
    label.className = "pbm-label";
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(controlNode);
    return { wrap };
  }

  function inputText(value) {
    const i = document.createElement("input");
    i.className = "pbm-input";
    i.type = "text";
    i.value = value || "";
    return i;
  }

  // ---------- Create folder ----------
  createFolderBtn.addEventListener("click", () => {
    const body = document.createElement("div");
    const nameInput = inputText("");
    nameInput.placeholder = "Например: Работа / Учёба / Инструменты";
    const dd = folderDropdown({ allowNone: true });

    body.appendChild(field("Название папки", nameInput).wrap);
    body.appendChild(field("Где создать (необязательно)", dd.wrap).wrap);

    openModal("Создать папку", body, "Создать");

    modalOk.onclick = async () => {
      const title = nameInput.value.trim();
      const parentId = dd.value || null;
      if (!title) return;

      await chrome.runtime.sendMessage({ type: "CREATE_FOLDER", title, parentId });
      dd.destroy();
      closeModal();
      await loadBookmarks();
    };

    modalCancel.onclick = () => {
      dd.destroy();
      closeModal();
    };
  });

  // ---------- Add bookmark ----------
  addBookmarkBtn.addEventListener("click", async () => {
    const body = document.createElement("div");

    const urlInput = inputText("");
    urlInput.placeholder = "https://example.com";
    const titleInput = inputText("");
    titleInput.placeholder = "Название (можно оставить пустым)";

    const dd = folderDropdown({ allowNone: true });

    const takeCurrent = document.createElement("button");
    takeCurrent.className = "pbm-btn";
    takeCurrent.type = "button";
    takeCurrent.textContent = "Подставить текущую страницу";
    takeCurrent.style.width = "100%";
    takeCurrent.style.marginBottom = "10px";

    takeCurrent.onclick = async () => {
      const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" });
      if (active?.ok) {
        urlInput.value = active.tab.url || "";
        if (!titleInput.value.trim()) titleInput.value = active.tab.title || "";
      }
    };

    body.appendChild(takeCurrent);
    body.appendChild(field("URL", urlInput).wrap);
    body.appendChild(field("Название", titleInput).wrap);
    body.appendChild(field("Папка (необязательно)", dd.wrap).wrap);

    openModal("Добавить закладку", body, "Добавить");

    modalOk.onclick = async () => {
      const url = urlInput.value.trim();
      let title = titleInput.value.trim();
      const parentId = dd.value || null;

      if (!url) return;
      if (!title) title = url;

      await chrome.runtime.sendMessage({ type: "CREATE_BOOKMARK", url, title, parentId });

      dd.destroy();
      closeModal();
      await loadBookmarks();
    };

    modalCancel.onclick = () => {
      dd.destroy();
      closeModal();
    };
  });

  // ---------- Restore last deleted ----------
  restoreBtn.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "RESTORE_LAST_DELETED" });
    if (res?.ok) {
      await loadBookmarks();
    } else {
      // мягко, без алертов: можно показать модалку
      const body = document.createElement("div");
      body.style.fontSize = "13px";
      body.style.opacity = "0.9";
      body.textContent = "Корзина пуста — нечего восстанавливать.";
      openModal("Восстановление", body, "Ок", "Закрыть");
      modalOk.onclick = closeModal;
      modalCancel.onclick = closeModal;
    }
  });

  // ---------------- Init ----------------
  loadBookmarks();
  toggle(false);
})();
