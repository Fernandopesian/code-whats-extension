(function () {
  const storage = window.CodeWhatsStorage;
  let state = null;

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const clientsForColumn = (columnId) => state.clients.filter((client) => client.funnelId === activeFunnel().id && client.columnId === columnId);

  const render = () => {
    const funnel = activeFunnel();
    document.querySelector('[data-role="crm-app"]').innerHTML = `
      <header class="cwl-crm-header">
        <div><p class="cwl-kicker">Nova janela CRM</p><h1>CODE Whats Local</h1></div>
        <div class="cwl-inline-actions">
          <label class="cwl-field"><span>Funil</span><select data-action="change-funnel">${state.funnels.map((item) => `<option value="${item.id}" ${item.id === funnel.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
          <button class="cwl-btn cwl-btn-ghost" data-action="new-tag">Nova etiqueta</button>
          <button class="cwl-btn cwl-btn-primary" data-action="reload">Atualizar</button>
        </div>
      </header>
      <section class="cwl-crm-board">
        ${funnel.columns.map((column) => `
          <article class="cwl-crm-column" data-column-id="${column.id}">
            <header><h2>${esc(column.name)}</h2></header>
            <div class="cwl-crm-dropzone" data-column-id="${column.id}">
              ${clientsForColumn(column.id).map(renderCard).join("") || `<p class="cwl-empty">Sem contatos.</p>`}
            </div>
          </article>
        `).join("")}
      </section>
    `;
  };

  const renderCard = (client) => `
    <article class="cwl-card" draggable="true" data-client-id="${client.id}">
      <div class="cwl-card-top"><div><strong>${esc(client.name)}</strong><span>${esc(client.phone || client.chatTitle || "WhatsApp")}</span></div><em class="cwl-temp cwl-temp-${client.temperature}">${esc(client.temperature)}</em></div>
      <div class="cwl-tags">${(client.tags || []).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
      <div class="cwl-card-meta"><span>${money.format(client.value || 0)}</span><span>${client.pinned ? "Fixado" : ""}</span></div>
      <div class="cwl-card-actions"><button data-action="open-whatsapp" data-client-id="${client.id}">Abrir no WhatsApp</button><button data-action="add-tag" data-client-id="${client.id}">Etiqueta</button></div>
    </article>
  `;

  const openInWhatsApp = async (clientId) => {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (!tabs.length) {
      await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
      alert("Abra o WhatsApp Web e tente novamente. A conversa sera aberta pela aba ativa da extensao quando o content script estiver carregado.");
      return;
    }
    await chrome.tabs.update(tabs[0].id, { active: true });
    chrome.tabs.sendMessage(tabs[0].id, { type: "CWL_OPEN_CLIENT", clientId });
  };

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action], .cwl-card");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "reload") { state = await storage.getState(); render(); }
    if (action === "new-tag") {
      const tag = prompt("Nome da nova etiqueta:");
      if (tag) {
        state.tags = Array.from(new Set([...(state.tags || []), clean(tag)]));
        state = await storage.saveState(state);
        render();
      }
    }
    if (action === "add-tag") {
      const client = state.clients.find((item) => item.id === target.dataset.clientId);
      const tag = prompt("Etiqueta para este cliente:", (state.tags || [])[0] || "");
      if (client && tag) {
        client.tags = Array.from(new Set([...(client.tags || []), clean(tag)]));
        state = await storage.upsertClient(client);
        render();
      }
    }
    if (action === "open-whatsapp") openInWhatsApp(target.dataset.clientId);
    if (target.classList.contains("cwl-card")) openInWhatsApp(target.dataset.clientId);
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches('[data-action="change-funnel"]')) {
      state.activeFunnelId = event.target.value;
      state = await storage.saveState(state);
      render();
    }
  });

  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".cwl-card");
    if (!card) return;
    event.dataTransfer.setData("text/plain", card.dataset.clientId);
    card.classList.add("is-dragging");
  });

  document.addEventListener("dragend", (event) => {
    const card = event.target.closest(".cwl-card");
    if (card) card.classList.remove("is-dragging");
  });

  document.addEventListener("dragover", (event) => {
    const zone = event.target.closest(".cwl-crm-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-over");
  });

  document.addEventListener("dragleave", (event) => {
    const zone = event.target.closest(".cwl-crm-dropzone");
    if (zone) zone.classList.remove("is-over");
  });

  document.addEventListener("drop", async (event) => {
    const zone = event.target.closest(".cwl-crm-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const clientId = event.dataTransfer.getData("text/plain");
    if (clientId) {
      state = await storage.moveClient(clientId, zone.dataset.columnId);
      render();
    }
  });

  const boot = async () => {
    state = await storage.getState();
    render();
  };

  boot();
})();
