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

  row2.appendChild(createFolderBtn);
  row2.appendChild(addBookmarkBtn);

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
  let folderOptions = []; // {id, titlePath}
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

  function faviconForUrl(url) {
    try {
      const u = new URL(url);
      return `${u.origin}/favicon.ico`;
    } catch {
      return "";
    }
  }

  function openModal(title, bodyNode, okText = "OK") {
    modalTitle.textContent = title;
    modalBody.innerHTML = "";
    modalBody.appendChild(bodyNode);
    modalOk.textContent = okText;
    modalOverlay.style.display = "flex";
  }

  function closeModal() {
    modalOverlay.style.display = "none";
    modalBody.innerHTML = "";
  }

  modalCancel.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ---------------- Bookmarks load ----------------
  async function loadBookmarks() {
    const res = await chrome.runtime.sendMessage({ type: "GET_BOOKMARK_TREE" });
    if (!res?.ok) return;

    const root = res.tree?.[0];
    const nodes = root?.children ?? [];
    originalNodes = nodes.flatMap((n) => n.children ?? []);

    // собрать список папок для селектора
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
    // Корень (панель закладок) — будем использовать специальный id = null
    out.sort((a, b) => a.titlePath.localeCompare(b.titlePath, "ru"));
    return out;
  }

  // ---------------- Filtering (поиск по папкам + закладкам + url) ----------------
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

  // ---------------- Render (быстрее: DocumentFragment + минимум перерисовок) ----------------
  function renderTree(nodes, query) {
    lastRenderQuery = query || "";
    const filtered = filterTree(nodes, lastRenderQuery);

    // Полная перерисовка контента — но делаем ее дешёвой
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

  function renderNode(node, forceExpand) {
    if (isFolder(node)) {
      const wrap = document.createElement("div");

      const row = document.createElement("div");
      row.className = "pbm-item pbm-folder-row";

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

      row.appendChild(icon);
      row.appendChild(title);

      const children = document.createElement("div");
      children.className = "pbm-children";

      const kids = node.children || [];
      const frag = document.createDocumentFragment();
      for (const ch of kids) frag.appendChild(renderNode(ch, forceExpand));
      children.appendChild(frag);

      if (forceExpand || node.__pbmAutoExpand) {
        row.classList.add("pbm-expanded");
      }

      row.addEventListener("click", () => {
        row.classList.toggle("pbm-expanded");
      });

      wrap.appendChild(row);
      wrap.appendChild(children);
      return wrap;
    }

    const row = document.createElement("div");
    row.className = "pbm-item";
    row.dataset.url = node.url || "";

    const ico = document.createElement("img");
    ico.className = "pbm-favicon";
    ico.alt = "";
    ico.referrerPolicy = "no-referrer";
    ico.loading = "lazy";
    ico.src = node.url ? faviconForUrl(node.url) : "";

    const title = document.createElement("div");
    title.className = "pbm-title";
    title.textContent = node.title || node.url || "Закладка";

    row.appendChild(ico);
    row.appendChild(title);

    row.addEventListener("click", () => {
      const url = row.dataset.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });

    return row;
  }

  // ---------------- Actions ----------------
  handle.addEventListener("click", () => toggle());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) toggle(false);
    if (e.key === "Escape" && modalOverlay.style.display === "flex") closeModal();
  });

  collapseBtn.addEventListener("click", () => {
    sidebar.querySelectorAll(".pbm-folder-row.pbm-expanded").forEach((el) => {
      el.classList.remove("pbm-expanded");
    });
  });

  search.addEventListener("input", () => {
    const q = search.value || "";
    // debounce, чтобы не лагало
    debounce(() => {
      // рендерим в rAF, чтобы было плавнее
      requestAnimationFrame(() => renderTree(originalNodes, q));
    }, 120);
  });

  // ---------- Create folder modal ----------
  createFolderBtn.addEventListener("click", () => {
    const body = document.createElement("div");

    const f1 = field("Название папки", inputText("Новая папка"));
    const f2 = field("Где создать", selectFolder());

    body.appendChild(f1.wrap);
    body.appendChild(f2.wrap);

    openModal("Создать папку", body, "Создать");

    modalOk.onclick = async () => {
      const title = f1.input.value.trim();
      const parentId = f2.select.value || null;

      if (!title) return;

      try {
        await chrome.bookmarks.create({ parentId: parentId || undefined, title });
      } catch (e) {
        // тихо
      }
      closeModal();
      await loadBookmarks();
    };
  });

  // ---------- Add bookmark modal ----------
  addBookmarkBtn.addEventListener("click", async () => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" });
    const activeUrl = active?.ok ? (active.tab.url || "") : "";
    const activeTitle = active?.ok ? (active.tab.title || "") : "";

    const body = document.createElement("div");

    const fUrl = field("URL", inputText(activeUrl || "https://"));
    const fTitle = field("Название", inputText(activeTitle || ""));
    const fFolder = field("Папка (необязательно)", selectFolder(true));

    // кнопка "взять из текущей вкладки"
    const takeCurrent = document.createElement("button");
    takeCurrent.className = "pbm-btn";
    takeCurrent.type = "button";
    takeCurrent.textContent = "Подставить текущую страницу";
    takeCurrent.style.width = "100%";
    takeCurrent.style.marginBottom = "10px";

    takeCurrent.onclick = async () => {
      const a = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" });
      if (a?.ok) {
        fUrl.input.value = a.tab.url || "";
        if (!fTitle.input.value.trim()) fTitle.input.value = a.tab.title || "";
      }
    };

    body.appendChild(takeCurrent);
    body.appendChild(fUrl.wrap);
    body.appendChild(fTitle.wrap);
    body.appendChild(fFolder.wrap);

    openModal("Добавить закладку", body, "Добавить");

    modalOk.onclick = async () => {
      const url = fUrl.input.value.trim();
      let title = fTitle.input.value.trim();
      const parentId = fFolder.select.value || null;

      if (!url) return;
      if (!title) title = url;

      try {
        await chrome.bookmarks.create({
          parentId: parentId || undefined,
          title,
          url
        });
      } catch (e) {
        // тихо
      }

      closeModal();
      await loadBookmarks();
    };
  });

  // ---------------- UI field helpers ----------------
  function field(labelText, control) {
    const wrap = document.createElement("div");
    wrap.className = "pbm-field";

    const label = document.createElement("div");
    label.className = "pbm-label";
    label.textContent = labelText;

    wrap.appendChild(label);
    wrap.appendChild(control);

    return {
      wrap,
      input: control.tagName === "INPUT" ? control : null,
      select: control.tagName === "SELECT" ? control : null
    };
  }

  function inputText(value) {
    const i = document.createElement("input");
    i.className = "pbm-input";
    i.type = "text";
    i.value = value || "";
    return i;
  }

  function selectFolder(allowNone = false) {
    const s = document.createElement("select");
    s.className = "pbm-select";

    if (allowNone) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Без папки (в корень)";
      s.appendChild(opt);
    }

    for (const f of folderOptions) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.titlePath;
      s.appendChild(opt);
    }

    return s;
  }

  // ---------------- Init ----------------
  loadBookmarks();
  toggle(false);
})();
