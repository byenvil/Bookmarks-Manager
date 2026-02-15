(() => {
  if (window.__pbmInjected) return;
  window.__pbmInjected = true;

  // --- UI nodes ---
  const handle = document.createElement("div");
  handle.id = "pbm-handle";

  const sidebar = document.createElement("div");
  sidebar.id = "pbm-sidebar";

  const header = document.createElement("div");
  header.id = "pbm-header";

  const search = document.createElement("input");
  search.id = "pbm-search";
  search.type = "text";
  search.placeholder = "Поиск закладок…";

  const collapseBtn = document.createElement("button");
  collapseBtn.id = "pbm-collapse";
  collapseBtn.type = "button";
  collapseBtn.textContent = "Свернуть все";

  const content = document.createElement("div");
  content.id = "pbm-content";

  header.appendChild(search);
  header.appendChild(collapseBtn);
  sidebar.appendChild(header);
  sidebar.appendChild(content);

  document.documentElement.appendChild(handle);
  document.documentElement.appendChild(sidebar);

  // --- state ---
  let isOpen = false;
  let originalNodes = []; // исходное дерево (корневые папки закладок)

  function toggle(open = !isOpen) {
    isOpen = open;
    handle.classList.toggle("pbm-open", isOpen);
    sidebar.classList.toggle("pbm-open", isOpen);
  }

  handle.addEventListener("click", () => toggle());

  // close by ESC
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) toggle(false);
  });

  // --- bookmarks tree fetch ---
  async function loadBookmarks() {
    const res = await chrome.runtime.sendMessage({ type: "GET_BOOKMARK_TREE" });
    if (!res?.ok) return;

    const root = res.tree?.[0];
    const nodes = root?.children ?? [];
    // Обычно интересны "Bookmarks bar" и "Other bookmarks"
    originalNodes = nodes.flatMap((n) => n.children ?? []);
    renderTree(originalNodes, "");
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

  // --- Filtering: оставляем папки, если они совпали или внутри есть совпавшие закладки/папки
  function filterTree(nodes, q) {
    const query = q.trim().toLowerCase();
    if (!query) return { filtered: nodes, autoExpandAll: false };

    const matchesText = (s) => (s || "").toLowerCase().includes(query);

    const walk = (node) => {
      if (isFolder(node)) {
        const kids = (node.children || [])
          .map(walk)
          .filter(Boolean);

        const folderMatches = matchesText(node.title);
        if (folderMatches || kids.length > 0) {
          return {
            ...node,
            children: kids,
            __pbmAutoExpand: true // если ищем — раскрываем результаты
          };
        }
        return null;
      } else {
        const title = node.title || "";
        const url = node.url || "";
        const ok = matchesText(title) || matchesText(url);
        return ok ? node : null;
      }
    };

    const filtered = nodes.map(walk).filter(Boolean);

    return { filtered, autoExpandAll: true };
  }

  function renderTree(nodes, query) {
    content.innerHTML = "";

    const { filtered } = filterTree(nodes, query);

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "pbm-empty";
      empty.textContent = "Ничего не найдено.";
      content.appendChild(empty);
      return;
    }

    const container = document.createElement("div");
    filtered.forEach((node) => container.appendChild(renderNode(node, !!query.trim())));
    content.appendChild(container);
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

      (node.children || []).forEach((ch) => children.appendChild(renderNode(ch, forceExpand)));

      // При поиске — раскрываем нужные ветки автоматически
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

    // bookmark leaf
    const row = document.createElement("div");
    row.className = "pbm-item";
    row.dataset.url = node.url || "";

    const ico = document.createElement("img");
    ico.className = "pbm-favicon";
    ico.alt = "";
    ico.referrerPolicy = "no-referrer";
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

  // --- Search: теперь ищет по всем закладкам (title + url), и перерисовывает дерево
  search.addEventListener("input", () => {
    const q = search.value || "";
    renderTree(originalNodes, q);
  });

  // --- Collapse all
  collapseBtn.addEventListener("click", () => {
    sidebar.querySelectorAll(".pbm-folder-row.pbm-expanded").forEach((el) => {
      el.classList.remove("pbm-expanded");
    });
  });

  // --- init ---
  loadBookmarks();
  toggle(false);
})();
