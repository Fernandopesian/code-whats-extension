(function () {
  if (window.__codeWhatsLocalV3Loaded) return;
  window.__codeWhatsLocalV3Loaded = true;

  const storage = window.CodeWhatsStorage;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const navItems = [
    { id: "kanban", icon: "K", label: "Kanban" },
    { id: "clients", icon: "C", label: "Clientes" },
    { id: "notes", icon: "N", label: "Notas" },
    { id: "backup", icon: "B", label: "Backup" },
    { id: "settings", icon: "S", label: "Configuracoes" }
  ];

  let state = null;
  let drawerOpen = true;
  let activeView = "kanban";
  let modal = null;
  let currentConversation = null;
  let scanTimer = null;
  let observer = null;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const phoneOnly = (value) => clean(value).replace(/\D/g, "");
  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const isPastDue = (reminder) => reminder.dueAt && !reminder.done && new Date(reminder.dueAt).getTime() < Date.now();

  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const activeClients = () => state.clients.filter((client) => client.funnelId === activeFunnel().id);
  const pinnedClients = () => state.pinnedClientIds.map((id) => state.clients.find((client) => client.id === id)).filter(Boolean);

  const getRoot = () => {
    let root = qs("#code-whats-local-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "code-whats-local-root";
      document.body.appendChild(root);
    }
    return root;
  };

  const shiftWhatsApp = () => {
    const app = qs("#app") || document.body;
    const width = drawerOpen ? "430px" : "72px";
    document.documentElement.style.setProperty("--cwl-drawer-width", width);
    app.style.setProperty("--cwl-drawer-width", width);
    app.classList.add("cwl-whatsapp-shifted");
  };

  const captureConversation = () => {
    const main = qs("main") || qs('div[role="application"]') || document.body;
    const header = qs("header", main) || qs("header");
    const titleNode = header && (qs('span[title]', header) || qs('span[dir="auto"]', header));
    const title = clean(titleNode && (titleNode.getAttribute("title") || titleNode.textContent));
    const headerText = clean(header && header.textContent);
    const phoneMatch = headerText.match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = phoneOnly(phoneMatch && phoneMatch[0]);
    const aboutNode = header && qsa("span", header).map((node) => clean(node.textContent)).find((text) => text && text !== title && text.length > 3 && !/online|digitando/i.test(text));
    const messages = qsa('div[data-pre-plain-text], div.message-in, div.message-out, div[role="row"]', main).filter((node) => clean(node.textContent).length > 0);
    const lastNode = messages[messages.length - 1];
    const pre = lastNode && lastNode.getAttribute("data-pre-plain-text");
    const timeMatch = pre && pre.match(/\[(.*?)\]/);
    const hasConversation = Boolean(title && messages.length > 0);

    return {
      hasConversation,
      name: title || "",
      chatTitle: title || "",
      phone,
      about: aboutNode || "",
      waKey: phone || title || "",
      lastMessage: clean(lastNode && lastNode.textContent).slice(0, 360),
      lastMessageTime: timeMatch ? timeMatch[1] : "",
      visibleMessageCount: messages.length,
      capturedAt: new Date().toISOString()
    };
  };

  const findClientForConversation = () => {
    if (!currentConversation || !currentConversation.hasConversation) return null;
    const key = currentConversation.waKey;
    const phone = currentConversation.phone;
    const title = currentConversation.chatTitle;
    return state.clients.find((client) =>
      (phone && phoneOnly(client.phone) === phone) ||
      (key && client.waKey === key) ||
      (title && clean(client.chatTitle || client.name).toLowerCase() === title.toLowerCase())
    );
  };

  const selectedClient = () => (modal && modal.clientId ? state.clients.find((client) => client.id === modal.clientId) : null) || findClientForConversation() || activeClients()[0] || null;

  const refreshConversation = () => {
    const next = captureConversation();
    const changed = JSON.stringify(next) !== JSON.stringify(currentConversation);
    currentConversation = next;
    if (changed && state) render();
  };

  const totals = () => {
    const clients = activeClients();
    return {
      total: clients.length,
      hot: clients.filter((client) => client.temperature === "quente").length,
      overdue: clients.reduce((sum, client) => sum + client.reminders.filter(isPastDue).length, 0),
      value: clients.reduce((sum, client) => sum + (Number(client.value) || 0), 0)
    };
  };

  const render = () => {
    if (!state) return;
    shiftWhatsApp();
    getRoot().innerHTML = `
      <aside class="cwl-shell ${drawerOpen ? "is-open" : "is-closed"}">
        ${renderSidebar()}
        ${drawerOpen ? renderPanel() : ""}
      </aside>
      ${renderContextActions()}
      ${renderModal()}
    `;
  };

  const renderSidebar = () => `
    <nav class="cwl-sidebar">
      <button class="cwl-brand" data-action="toggle-drawer"><span>CW</span>${drawerOpen ? "<strong>CODE Whats</strong>" : ""}</button>
      <div class="cwl-nav-list">
        ${navItems.map((item) => `
          <button class="cwl-nav-item ${activeView === item.id ? "is-active" : ""}" data-action="set-view" data-view="${item.id}">
            <span>${item.icon}</span>${drawerOpen ? `<strong>${item.label}</strong>` : ""}
          </button>
        `).join("")}
      </div>
    </nav>
  `;

  const renderPanel = () => {
    const current = currentConversation && currentConversation.hasConversation ? currentConversation.name : "Nenhuma conversa aberta";
    const data = totals();
    return `
      <section class="cwl-panel">
        <header class="cwl-topbar">
          <div><p class="cwl-kicker">Central CRM local</p><h1>${labelForView(activeView)}</h1></div>
          <button class="cwl-icon-btn" data-action="toggle-drawer">‹</button>
        </header>
        <section class="cwl-current-chat">
          <span>Contato ativo</span>
          <strong>${esc(current)}</strong>
          <small>${esc(conversationMeta())}</small>
        </section>
        ${activeView === "kanban" ? `<section class="cwl-stats">${stat("Clientes", data.total)}${stat("Quentes", data.hot)}${stat("Vencidos", data.overdue)}${stat("Valor", money.format(data.value))}</section>` : ""}
        ${renderView()}
      </section>
    `;
  };

  const labelForView = (view) => (navItems.find((item) => item.id === view) || navItems[0]).label;
  const stat = (label, value) => `<article class="cwl-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;

  const conversationMeta = () => {
    if (!currentConversation || !currentConversation.hasConversation) return "Abra uma conversa para usar acoes contextuais.";
    const parts = [];
    if (currentConversation.phone) parts.push(currentConversation.phone);
    parts.push(`${currentConversation.visibleMessageCount} mensagens visiveis`);
    if (currentConversation.lastMessageTime) parts.push(currentConversation.lastMessageTime);
    return parts.join(" • ");
  };

  const renderView = () => {
    if (activeView === "clients") return renderClients();
    if (activeView === "notes") return renderNotesArea();
    if (activeView === "backup") return renderBackup();
    if (activeView === "settings") return renderSettings();
    return renderKanban();
  };

  const renderFunnelControls = () => `
    <section class="cwl-toolbar">
      <label class="cwl-field"><span>Funil</span><select data-action="change-funnel">${state.funnels.map((funnel) => `<option value="${funnel.id}" ${funnel.id === activeFunnel().id ? "selected" : ""}>${esc(funnel.name)}</option>`).join("")}</select></label>
      <button class="cwl-btn cwl-btn-ghost" data-action="new-funnel">Novo funil</button>
      <button class="cwl-btn cwl-btn-ghost" data-action="new-column">Nova etapa</button>
    </section>
  `;

  const renderKanban = () => `
    ${renderFunnelControls()}
    <section class="cwl-kanban-actions"><button class="cwl-btn cwl-btn-primary" data-action="open-crm-window">Nova janela</button></section>
    <main class="cwl-kanban">${activeFunnel().columns.map(renderColumn).join("")}</main>
  `;

  const renderColumn = (column) => {
    const clients = activeClients().filter((client) => client.columnId === column.id);
    return `
      <section class="cwl-column" data-column-id="${column.id}">
        <header>
          <input class="cwl-column-title" data-action="rename-column" data-column-id="${column.id}" value="${esc(column.name)}">
          <span>${clients.length}</span>
          <button data-action="delete-column" data-column-id="${column.id}">×</button>
        </header>
        <div class="cwl-dropzone" data-column-id="${column.id}">${clients.map(renderCard).join("") || `<p class="cwl-empty">Sem contatos nesta etapa.</p>`}</div>
      </section>
    `;
  };

  const renderCard = (client) => `
    <article class="cwl-card ${client.reminders.some(isPastDue) ? "has-alert" : ""}" draggable="true" data-client-id="${client.id}">
      <div class="cwl-card-top"><div><strong>${esc(client.name)}</strong><span>${esc(client.phone || client.chatTitle || "Contato WhatsApp")}</span></div><em class="cwl-temp cwl-temp-${client.temperature}">${esc(client.temperature)}</em></div>
      <div class="cwl-tags">${(client.tags || []).slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
      ${client.nextAction ? `<p class="cwl-next">${esc(client.nextAction)}</p>` : ""}
      <div class="cwl-card-actions"><button data-action="open-profile" data-client-id="${client.id}">Perfil</button><button data-action="open-client-chat" data-client-id="${client.id}">Chat</button></div>
    </article>
  `;

  const renderClients = () => `
    <section class="cwl-client-list">
      <h2>Fixados</h2>
      ${pinnedClients().map(renderClientRow).join("") || `<p class="cwl-empty">Nenhum chat fixado localmente.</p>`}
      <h2>Todos os clientes</h2>
      ${state.clients.map(renderClientRow).join("") || `<p class="cwl-empty">Nenhum cliente salvo.</p>`}
    </section>
  `;

  const renderClientRow = (client) => `
    <article class="cwl-row ${client.reminders.some(isPastDue) ? "has-alert" : ""}">
      <button data-action="open-profile" data-client-id="${client.id}"><strong>${esc(client.name)}</strong><span>${esc(client.phone || client.chatTitle || client.waKey)}</span></button>
      <button data-action="open-client-chat" data-client-id="${client.id}">Chat</button>
      <button data-action="toggle-pin" data-client-id="${client.id}">${client.pinned ? "Desafixar" : "Fixar"}</button>
    </article>
  `;

  const renderNotesArea = () => {
    const client = selectedClient();
    if (!client) return `<section class="cwl-card-panel"><p class="cwl-empty">Selecione um cliente para ver notas.</p></section>`;
    return `<section class="cwl-card-panel"><h2>${esc(client.name)}</h2><button class="cwl-btn cwl-btn-primary" data-action="context-note">Adicionar anotacao</button>${renderNotes(client)}${renderReminders(client)}</section>`;
  };

  const renderBackup = () => `
    <section class="cwl-card-panel">
      <h2>Backup local</h2>
      <p>Exporta e importa funis, colunas, clientes, notas, lembretes, fixados e etiquetas.</p>
      <div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-primary" data-action="export-backup">Exportar JSON</button><button class="cwl-btn cwl-btn-ghost" data-action="import-backup">Importar JSON</button></div>
      <input class="cwl-file-input" type="file" accept="application/json" data-role="backup-file">
    </section>
  `;

  const renderSettings = () => `
    <section class="cwl-card-panel"><h2>Configuracoes</h2><p>Dados locais em chrome.storage.local. Sem backend, sem login e sem envio em massa.</p></section>
  `;

  const renderContextActions = () => {
    if (!currentConversation || !currentConversation.hasConversation) return "";
    return `
      <section class="cwl-contextbar">
        <button data-action="open-add-current">Adicionar ao funil</button>
        <button data-action="open-reminder-modal">Criar lembrete</button>
        <button data-action="context-note">Adicionar anotacao</button>
        <button data-action="show-current-profile">Perfil do contato</button>
        <button data-action="pin-current-chat">Fixar chat local</button>
      </section>
    `;
  };

  const renderModal = () => {
    if (!modal) return "";
    if (modal.type === "add") return renderAddModal();
    if (modal.type === "profile") return renderProfileModal();
    if (modal.type === "reminder") return renderReminderModal();
    return "";
  };

  const renderAddModal = () => {
    const conversation = currentConversation || captureConversation();
    const funnel = state.funnels.find((item) => item.id === (modal.funnelId || state.activeFunnelId)) || activeFunnel();
    return `
      <div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="add-form">
        <header><h2>Adicionar contato ao funil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>
        <div class="cwl-form-grid">
          ${input("Nome", "name", conversation.name, "text", true)}${input("Telefone", "phone", conversation.phone, "tel")}
          <label class="cwl-field"><span>Funil</span><select name="funnelId" data-action="modal-funnel-change">${state.funnels.map((item) => `<option value="${item.id}" ${item.id === funnel.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
          <label class="cwl-field"><span>Etapa</span><select name="columnId">${funnel.columns.map((column) => `<option value="${column.id}">${esc(column.name)}</option>`).join("")}</select></label>
          ${input("Novo funil", "newFunnel", "")}${input("Nova etapa", "newColumn", "")}${input("Etiquetas", "tags", "WhatsApp")}
          <label class="cwl-field"><span>Temperatura</span><select name="temperature"><option value="frio">frio</option><option value="morno" selected>morno</option><option value="quente">quente</option></select></label>
          ${input("Valor estimado", "value", "", "number")}
          <label class="cwl-field cwl-field-wide"><span>Observacoes</span><textarea name="note" rows="3">Ultima mensagem: ${esc(conversation.lastMessage || "nao encontrada")}</textarea></label>
          <label class="cwl-field cwl-field-wide"><span>Proxima acao</span><textarea name="nextAction" rows="2"></textarea></label>
        </div>
        <footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar</button></footer>
      </form></div>
    `;
  };

  const renderProfileModal = () => {
    const client = modal.clientId ? state.clients.find((item) => item.id === modal.clientId) : findClientForConversation();
    const captured = (client && client.captured) || currentConversation || {};
    return `
      <div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal cwl-profile-modal" data-role="profile-form">
        <header><h2>Perfil do contato</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>
        <section class="cwl-captured-grid">
          ${info("Nome", (client && client.name) || captured.name || "nao encontrado")}${info("Telefone", (client && client.phone) || captured.phone || "nao encontrado")}${info("Sobre", (client && client.about) || captured.about || "nao encontrado")}${info("Ultima mensagem", captured.lastMessage || "nao encontrada")}${info("Horario", captured.lastMessageTime || "nao encontrado")}
        </section>
        <input type="hidden" name="clientId" value="${esc(client && client.id)}">
        <div class="cwl-form-grid">
          ${input("Observacoes", "note", client && client.note)}
          <label class="cwl-field"><span>Temperatura</span><select name="temperature">${["frio", "morno", "quente"].map((temp) => `<option value="${temp}" ${client && client.temperature === temp ? "selected" : ""}>${temp}</option>`).join("")}</select></label>
          ${input("Valor estimado", "value", client && client.value, "number")}${input("Proxima acao", "nextAction", client && client.nextAction)}${input("Etiquetas", "tags", client && (client.tags || []).join(", "))}
        </div>
        ${client ? `<section class="cwl-profile-lists">${renderNotes(client)}${renderReminders(client)}</section>` : `<p class="cwl-empty">Salve o contato no funil para vincular notas e lembretes.</p>`}
        <footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar perfil</button></footer>
      </form></div>
    `;
  };

  const renderReminderModal = () => `
    <div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="reminder-form">
      <header><h2>Criar lembrete</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>
      <div class="cwl-form-grid">${input("Titulo", "title", "", "text", true)}${input("Data/hora", "dueAt", "", "datetime-local")}<label class="cwl-field cwl-field-wide"><span>Observacao</span><textarea name="note" rows="3"></textarea></label></div>
      <footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar lembrete</button></footer>
    </form></div>
  `;

  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;
  const info = (label, value) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
  const renderNotes = (client) => client.notes.length ? `<h3>Anotacoes</h3><ul class="cwl-history">${client.notes.map((note) => `<li><span>${new Date(note.createdAt).toLocaleString("pt-BR")}</span>${esc(note.text)}</li>`).join("")}</ul>` : `<h3>Anotacoes</h3><p class="cwl-empty">Sem anotacoes.</p>`;
  const renderReminders = (client) => client.reminders.length ? `<h3>Lembretes</h3><ul class="cwl-history">${client.reminders.map((reminder) => `<li class="${isPastDue(reminder) ? "is-overdue" : ""}"><span>${esc(reminder.dueAt || "Sem data")}</span><strong>${esc(reminder.title)}</strong>${reminder.note ? `<p>${esc(reminder.note)}</p>` : ""}</li>`).join("")}</ul>` : `<h3>Lembretes</h3><p class="cwl-empty">Sem lembretes.</p>`;

  const saveUi = async () => { state.drawerOpen = drawerOpen; state.activeView = activeView; state = await storage.saveState(state); };
  const openCrmWindow = () => window.open(chrome.runtime.getURL("crm.html"), "code-whats-crm", "width=1180,height=760");

  const ensureCurrentClient = async () => {
    let client = findClientForConversation();
    if (client) return client;
    const funnel = activeFunnel();
    state = await storage.upsertClient({ funnelId: funnel.id, columnId: funnel.columns[0].id, name: currentConversation.name, phone: currentConversation.phone, about: currentConversation.about, chatTitle: currentConversation.chatTitle, waKey: currentConversation.waKey, tags: ["WhatsApp"], captured: currentConversation });
    return findClientForConversation();
  };

  const openChatNatively = (client) => {
    const terms = [client.chatTitle, client.name, client.phone].map(clean).filter(Boolean);
    const rows = qsa('div[role="row"], [data-testid="cell-frame-container"], [aria-label*="Chat"]');
    for (const row of rows) {
      const text = clean(row.textContent).toLowerCase();
      if (terms.some((term) => text.includes(term.toLowerCase()))) {
        row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        row.click();
        return true;
      }
    }
    const phone = phoneOnly(client.phone);
    if (phone) location.assign(`https://web.whatsapp.com/send?phone=${phone}`);
    return false;
  };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `code-whats-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClick = async (event) => {
    const target = event.target.closest("[data-action], .cwl-card");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-drawer") { drawerOpen = !drawerOpen; await saveUi(); render(); return; }
    if (action === "set-view") { activeView = target.dataset.view; await saveUi(); render(); return; }
    if (action === "open-add-current") { modal = { type: "add", funnelId: state.activeFunnelId }; render(); return; }
    if (action === "open-reminder-modal") { modal = { type: "reminder" }; render(); return; }
    if (action === "show-current-profile") { const client = await ensureCurrentClient(); modal = { type: "profile", clientId: client && client.id }; render(); return; }
    if (action === "open-profile") { modal = { type: "profile", clientId: target.dataset.clientId }; render(); return; }
    if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render(); } return; }
    if (action === "new-funnel") { const name = prompt("Nome do novo funil:"); if (name) state = await storage.createFunnel(name); render(); return; }
    if (action === "new-column") { const name = prompt("Nome da nova etapa:"); if (name) state = await storage.createColumn(activeFunnel().id, name); render(); return; }
    if (action === "delete-column") { if (confirm("Excluir esta etapa? Os cards serao movidos para outra etapa.")) state = await storage.deleteColumn(activeFunnel().id, target.dataset.columnId); render(); return; }
    if (action === "context-note") { const client = await ensureCurrentClient(); const text = prompt("Anotacao para este contato:"); if (client && text) state = await storage.addNote(client.id, text); render(); return; }
    if (action === "pin-current-chat") { const client = await ensureCurrentClient(); if (client) state = await storage.togglePinned(client.id); render(); return; }
    if (action === "toggle-pin") { state = await storage.togglePinned(target.dataset.clientId); render(); return; }
    if (action === "open-client-chat") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatNatively(client); return; }
    if (action === "open-crm-window") { openCrmWindow(); return; }
    if (action === "export-backup") { downloadBackup(); return; }
    if (action === "import-backup") { qs('[data-role="backup-file"]').click(); return; }
    if (target.classList.contains("cwl-card")) { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatNatively(client); }
  };

  const handleChange = async (event) => {
    if (event.target.matches('[data-action="change-funnel"]')) { state.activeFunnelId = event.target.value; state = await storage.saveState(state); render(); }
    if (event.target.matches('[data-action="modal-funnel-change"]')) { modal.funnelId = event.target.value; render(); }
    if (event.target.matches('[data-role="backup-file"]') && event.target.files[0]) {
      try { state = await storage.importState(JSON.parse(await event.target.files[0].text())); render(); }
      catch (error) { alert("Nao foi possivel importar o backup. Verifique se o JSON e valido."); }
    }
  };

  const handleInput = (event) => {
    if (!event.target.matches('[data-action="rename-column"]')) return;
    clearTimeout(event.target._cwlTimer);
    const inputEl = event.target;
    inputEl._cwlTimer = setTimeout(async () => { state = await storage.renameColumn(activeFunnel().id, inputEl.dataset.columnId, inputEl.value); }, 450);
  };

  const handleSubmit = async (event) => {
    if (event.target.matches('[data-role="add-form"]')) { event.preventDefault(); await submitAdd(event.target); }
    if (event.target.matches('[data-role="profile-form"]')) { event.preventDefault(); await submitProfile(event.target); }
    if (event.target.matches('[data-role="reminder-form"]')) { event.preventDefault(); await submitReminder(event.target); }
  };

  const submitAdd = async (form) => {
    const data = new FormData(form);
    let funnelId = data.get("funnelId");
    if (clean(data.get("newFunnel"))) { state = await storage.createFunnel(data.get("newFunnel")); funnelId = state.activeFunnelId; }
    if (clean(data.get("newColumn"))) state = await storage.createColumn(funnelId, data.get("newColumn"));
    const funnel = state.funnels.find((item) => item.id === funnelId);
    const columnId = clean(data.get("newColumn")) ? funnel.columns[funnel.columns.length - 1].id : data.get("columnId");
    state = await storage.upsertClient({ funnelId, columnId, name: data.get("name"), phone: data.get("phone"), about: currentConversation.about, chatTitle: currentConversation.chatTitle, waKey: currentConversation.waKey, tags: clean(data.get("tags")).split(",").map(clean).filter(Boolean), temperature: data.get("temperature"), value: data.get("value"), note: data.get("note"), nextAction: data.get("nextAction"), captured: currentConversation });
    modal = null;
    activeView = "kanban";
    render();
  };

  const submitProfile = async (form) => {
    const data = new FormData(form);
    let client = state.clients.find((item) => item.id === data.get("clientId")) || await ensureCurrentClient();
    state = await storage.upsertClient({ ...client, note: data.get("note"), temperature: data.get("temperature"), value: data.get("value"), nextAction: data.get("nextAction"), tags: clean(data.get("tags")).split(",").map(clean).filter(Boolean), captured: currentConversation || client.captured });
    modal = null;
    render();
  };

  const submitReminder = async (form) => {
    const data = new FormData(form);
    const client = await ensureCurrentClient();
    if (client) state = await storage.addReminder(client.id, { title: data.get("title"), dueAt: data.get("dueAt"), note: data.get("note") });
    modal = null;
    render();
  };

  const handleDragStart = (event) => { const card = event.target.closest(".cwl-card"); if (card) { event.dataTransfer.setData("text/plain", card.dataset.clientId); card.classList.add("is-dragging"); } };
  const handleDragEnd = (event) => { const card = event.target.closest(".cwl-card"); if (card) card.classList.remove("is-dragging"); };
  const handleDragOver = (event) => { const zone = event.target.closest(".cwl-dropzone"); if (zone) { event.preventDefault(); zone.classList.add("is-over"); } };
  const handleDragLeave = (event) => { const zone = event.target.closest(".cwl-dropzone"); if (zone) zone.classList.remove("is-over"); };
  const handleDrop = async (event) => { const zone = event.target.closest(".cwl-dropzone"); if (!zone) return; event.preventDefault(); zone.classList.remove("is-over"); const clientId = event.dataTransfer.getData("text/plain"); if (clientId) state = await storage.moveClient(clientId, zone.dataset.columnId); render(); };

  const bindEvents = () => {
    document.addEventListener("click", handleClick);
    document.addEventListener("change", handleChange);
    document.addEventListener("input", handleInput);
    document.addEventListener("submit", handleSubmit);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragend", handleDragEnd);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "CWL_OPEN_CLIENT") {
        const client = state.clients.find((item) => item.id === message.clientId);
        if (client) openChatNatively(client);
      }
    });
  };

  const bootObserver = () => {
    observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(refreshConversation, 700); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(refreshConversation, 4500);
  };

  const boot = async () => {
    state = await storage.getState();
    drawerOpen = state.drawerOpen !== false;
    activeView = state.activeView || "kanban";
    currentConversation = captureConversation();
    bindEvents();
    bootObserver();
    render();
  };

  boot();
})();
