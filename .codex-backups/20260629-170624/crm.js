(function () {
  const storage = window.CodeWhatsStorage;
  let state = null;

  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const clientsForColumn = (columnId) => state.clients.filter((client) => client.funnelId === activeFunnel().id && client.columnId === columnId);

  function render() {
    const funnel = activeFunnel();
    const detected = state.detectedChats || [];
    document.querySelector('[data-role="crm-app"]').innerHTML = `
      <header class="cwl-crm-header">
        <div><p class="cwl-kicker">Janela CRM</p><h1>CODE Whats Local</h1></div>
        <div class="cwl-inline-actions">
          <label class="cwl-field"><span>Funil</span><select data-action="change-funnel">${state.funnels.map((item) => `<option value="${item.id}" ${item.id === funnel.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
          <button class="cwl-btn cwl-btn-primary" data-action="reload">Atualizar</button>
        </div>
      </header>
      <section class="cwl-crm-board">
        <article class="cwl-crm-column cwl-inbox-column">
          <header><h2>Conversas em andamento</h2></header>
          <div class="cwl-crm-dropzone cwl-crm-inbox-zone">
            ${detected.map(renderDetectedCard).join("") || `<p class="cwl-empty">Abra o WhatsApp Web para sincronizar conversas visíveis.</p>`}
          </div>
        </article>
        ${funnel.columns.map((column) => `
          <article class="cwl-crm-column" data-column-id="${column.id}">
            <header><h2>${esc(column.name)}</h2></header>
            <div class="cwl-crm-dropzone" data-column-id="${column.id}">${clientsForColumn(column.id).map(renderCard).join("") || `<p class="cwl-empty">Sem clientes.</p>`}</div>
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderDetectedCard(chat) {
    return `<article class="cwl-card cwl-detected-card" draggable="true" data-detected-key="${esc(chat.key)}"><div class="cwl-card-top"><div><strong>${esc(chat.name)}</strong><span>${esc(chat.lastMessage || "Conversa detectada")}</span></div></div><div class="cwl-card-meta"><span>${esc(chat.lastMessageTime || "")}</span><span>Detectado</span></div></article>`;
  }

  function renderCard(client) {
    return `<article class="cwl-card" draggable="true" data-client-id="${client.id}"><div class="cwl-card-top"><div><strong>${esc(client.name)}</strong><span>${esc(client.phone || client.chatTitle || "WhatsApp")}</span></div><em class="cwl-temp cwl-temp-${client.temperature}">${esc(client.temperature)}</em></div><div class="cwl-card-meta"><span>${money.format(client.value || 0)}</span><span>${client.pinned ? "Fixado" : ""}</span></div><div class="cwl-card-actions"><button data-action="open-whatsapp" data-client-id="${client.id}">Abrir conversa</button></div></article>`;
  }

  async function addDetectedAsClient(chat, columnId) {
    state = await storage.upsertClient({ funnelId: activeFunnel().id, columnId, name: chat.name, phone: chat.phone || "", chatTitle: chat.chatTitle || chat.name, photo: chat.photo || "", waKey: chat.waKey || chat.key, tags: ["WhatsApp"], note: chat.lastMessage || "", lastMessage: chat.lastMessage || "", lastMessageTime: chat.lastMessageTime || "", captured: chat });
  }

  async function openInWhatsApp(clientId) {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (!tabs.length) { await chrome.tabs.create({ url: "https://web.whatsapp.com/" }); alert("Abra o WhatsApp Web para sincronizar e abrir conversas."); return; }
    await chrome.tabs.update(tabs[0].id, { active: true });
    chrome.tabs.sendMessage(tabs[0].id, { type: "CWL_OPEN_CLIENT", clientId });
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action], .cwl-card");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "reload") { state = await storage.getState(); render(); return; }
    if (action === "open-whatsapp") { openInWhatsApp(target.dataset.clientId); return; }
    if (target.classList.contains("cwl-card") && target.dataset.clientId) openInWhatsApp(target.dataset.clientId);
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches('[data-action="change-funnel"]')) { state.activeFunnelId = event.target.value; state = await storage.saveState(state); render(); }
  });

  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".cwl-card");
    if (!card) return;
    if (card.dataset.clientId) event.dataTransfer.setData("application/cwl-client", card.dataset.clientId);
    if (card.dataset.detectedKey) event.dataTransfer.setData("application/cwl-detected", card.dataset.detectedKey);
    card.classList.add("is-dragging");
  });
  document.addEventListener("dragend", (event) => { const card = event.target.closest(".cwl-card"); if (card) card.classList.remove("is-dragging"); });
  document.addEventListener("dragover", (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (zone && !zone.classList.contains("cwl-crm-inbox-zone")) { event.preventDefault(); zone.classList.add("is-over"); } });
  document.addEventListener("dragleave", (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (zone) zone.classList.remove("is-over"); });
  document.addEventListener("drop", async (event) => {
    const zone = event.target.closest(".cwl-crm-dropzone");
    if (!zone || zone.classList.contains("cwl-crm-inbox-zone")) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const clientId = event.dataTransfer.getData("application/cwl-client");
    const detectedKey = event.dataTransfer.getData("application/cwl-detected");
    if (clientId) state = await storage.moveClient(clientId, zone.dataset.columnId);
    if (detectedKey) {
      const chat = (state.detectedChats || []).find((item) => item.key === detectedKey);
      if (chat) await addDetectedAsClient(chat, zone.dataset.columnId);
    }
    state = await storage.getState();
    render();
  });

  async function boot() { state = await storage.getState(); render(); }
  boot();
})();
