(function () {
  if (window.__codeWhatsLocalV4Loaded) return;
  window.__codeWhatsLocalV4Loaded = true;

  const storage = window.CodeWhatsStorage;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const navItems = [
    { id: "kanban", icon: "K", label: "Kanban" },
    { id: "clients", icon: "C", label: "Clientes" },
    { id: "notes", icon: "N", label: "Notas" },
    { id: "backup", icon: "B", label: "Backup" }
  ];

  let state = null;
  let drawerOpen = true;
  let activeView = "kanban";
  let modal = null;
  let selectedClientId = "";
  let activeChat = null;
  let detectedChats = [];
  let observer = null;
  let scanTimer = null;
  let persistTimer = null;
  let lastScanSignature = "";
  let feedback = "";
  let isInteracting = false;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const phoneOnly = (value) => clean(value).replace(/\D/g, "");
  const isPastDue = (reminder) => reminder.dueAt && !reminder.done && new Date(reminder.dueAt).getTime() < Date.now();

  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const activeClients = () => state.clients.filter((client) => client.funnelId === activeFunnel().id);
  const selectedClient = () => state.clients.find((client) => client.id === selectedClientId) || findClientForChat(activeChat) || null;
  const pinnedClients = () => state.pinnedClientIds.map((id) => state.clients.find((client) => client.id === id)).filter(Boolean);

  function getConversationHeader() {
    return qs('header[data-testid="conversation-header"]') || qs('header[data-asset-chat-background]') || (qs("main") && qs("main").querySelector("header"));
  }

  function getActiveChatContext() {
    const header = getConversationHeader();
    if (!header) return { hasConversation: false };

    const nameNode = qs("#chatName", header) || qs('[data-testid="conversation-info-header-chat-title"]', header) || qs('span[title]', header) || qs('span[dir="auto"]', header);
    const name = clean(nameNode && (nameNode.getAttribute("title") || nameNode.textContent));
    const photoNode = qs("img", header);
    const photo = photoNode ? clean(photoNode.src) : "";
    const headerText = clean(header.textContent);
    const phoneMatch = headerText.match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = phoneOnly(phoneMatch && phoneMatch[0]);
    const main = qs("main") || document.body;
    const messages = qsa('div[data-pre-plain-text], div.message-in, div.message-out, div[role="row"]', main).filter((node) => clean(node.textContent));
    const lastNode = messages[messages.length - 1];
    const pre = lastNode && lastNode.getAttribute("data-pre-plain-text");
    const timeMatch = pre && pre.match(/\[(.*?)\]/);
    const lastMessage = clean(lastNode && lastNode.textContent).slice(0, 360);
    const timestamp = timeMatch ? timeMatch[1] : "";
    const localId = phone || [name, photo ? photo.slice(-32) : "no-photo", timestamp || String(messages.length)].filter(Boolean).join("|");

    return {
      hasConversation: Boolean(name),
      name: name || "Contato sem nome",
      chatTitle: name || "Contato sem nome",
      phone,
      photo,
      about: "",
      lastMessage,
      lastMessageTime: timestamp,
      visibleMessageCount: messages.length,
      waKey: localId,
      capturedAt: new Date().toISOString()
    };
  }

  function stripChatNoise(value) {
    return clean(value)
      .replace(/wds-ic-[\w-]+/gi, "")
      .replace(/ic-push-pin|archive-refreshed|status-dblcheck|message-dblcheck/gi, "")
      .replace(/Arquivadas\d*/gi, "")
      .replace(/\b\d+ mensagens? n[aã]o lidas?\b/gi, "")
      .trim();
  }

  function parseChatListItem(row, index) {
    const raw = stripChatNoise(row.textContent);
    if (!raw || /^(Arquivadas|Archived)\b/i.test(raw)) return null;

    const titleNode = qs('span[title]', row) || qs('[data-testid="cell-frame-title"] span', row) || qs('span[dir="auto"]', row);
    let name = stripChatNoise(titleNode && (titleNode.getAttribute("title") || titleNode.textContent));
    const timeMatch = raw.match(/\b\d{1,2}:\d{2}\b|\bhoje\b|\bontem\b|\bsegunda\b|\bterça\b|\bquarta\b|\bquinta\b|\bsexta\b|\bsábado\b|\bdomingo\b/i);
    const lastMessageTime = timeMatch ? timeMatch[0] : "";

    if (!name) name = stripChatNoise(raw.split(/\b\d{1,2}:\d{2}\b|\bhoje\b|\bontem\b|\bsegunda\b|\bterça\b|\bquarta\b|\bquinta\b|\bsexta\b|\bsábado\b|\bdomingo\b/i)[0]);
    if (!name || name.length > 60 || /^(status|comunidades|canais|nova conversa)$/i.test(name)) return null;

    const img = qs("img", row);
    const photo = img ? clean(img.src) : "";
    let lastMessage = stripChatNoise(raw.replace(name, "").replace(lastMessageTime, ""));
    if (lastMessage.length > 180) lastMessage = lastMessage.slice(-180);
    const unreadNode = qs('[aria-label*="mensagem"], [aria-label*="message"]', row);
    const unread = stripChatNoise(unreadNode && unreadNode.getAttribute("aria-label"));
    const key = [name, photo ? photo.slice(-32) : "no-photo", lastMessageTime || index].join("|");
    return { key, waKey: key, name, chatTitle: name, phone: "", photo, lastMessage, lastMessageTime, unread, capturedAt: new Date().toISOString() };
  }

  function getDetectedChats() {
    const rows = qsa('div[role="row"], [data-testid="cell-frame-container"]');
    const chats = [];
    const seen = new Set();
    rows.forEach((row, index) => {
      const chat = parseChatListItem(row, index);
      if (!chat) return;
      const seenKey = chat.name.toLowerCase();
      if (seen.has(seenKey)) return;
      seen.add(seenKey);
      chats.push(chat);
    });
    return chats.slice(0, 50);
  }

  function findClientForChat(chat) {
    if (!chat || !chat.hasConversation && !chat.key) return null;
    const key = chat.waKey || chat.key;
    const phone = phoneOnly(chat.phone);
    const title = clean(chat.chatTitle || chat.name).toLowerCase();
    return state.clients.find((client) =>
      (phone && phoneOnly(client.phone) === phone) ||
      (key && client.waKey === key) ||
      (title && clean(client.chatTitle || client.name).toLowerCase() === title)
    );
  }

  function scanWhatsApp(force = false) {
    if (modal || isInteracting) return;
    const nextActive = getActiveChatContext();
    const nextDetected = getDetectedChats();
    const signature = JSON.stringify({ active: nextActive.waKey, count: nextDetected.length, names: nextDetected.slice(0, 12).map((chat) => `${chat.name}:${chat.lastMessageTime}`) });
    if (!force && signature === lastScanSignature) return;
    lastScanSignature = signature;
    activeChat = nextActive;
    detectedChats = nextDetected;
    injectHeaderActions();
    scheduleDetectedPersist();
    render({ keepScroll: true });
  }

  function scheduleDetectedPersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      state = await storage.saveDetectedChats(detectedChats);
    }, 1200);
  }

  function injectHeaderActions() {
    const header = getConversationHeader();
    if (!header || !activeChat || !activeChat.hasConversation) {
      qsa(".cwl-native-actions").forEach((node) => node.remove());
      return;
    }

    let actions = qs(".cwl-native-actions", header);
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "cwl-native-actions";
      header.appendChild(actions);
    }

    actions.innerHTML = `
      <span>CODE</span>
      <button data-action="open-add-current">Adicionar ao funil</button>
      <button data-action="show-current-profile">Perfil</button>
      <button data-action="context-note">Nota</button>
      <button data-action="open-reminder-modal">Lembrete</button>
      <button data-action="pin-current-chat">Fixar local</button>
    `;
  }

  function getRoot() {
    let root = qs("#code-whats-local-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "code-whats-local-root";
      document.body.appendChild(root);
    }
    return root;
  }

  function shiftWhatsApp() {
    const app = qs("#app") || document.body;
    const width = drawerOpen ? "430px" : "72px";
    document.documentElement.style.setProperty("--cwl-drawer-width", width);
    app.style.setProperty("--cwl-drawer-width", width);
    app.classList.add("cwl-whatsapp-shifted");
  }

  function captureScroll() {
    const kanban = qs(".cwl-kanban");
    const columnScrolls = {};
    qsa(".cwl-dropzone").forEach((zone) => {
      if (zone.dataset.columnId) columnScrolls[zone.dataset.columnId] = zone.scrollTop;
    });
    return { kanbanLeft: kanban ? kanban.scrollLeft : 0, kanbanTop: kanban ? kanban.scrollTop : 0, columnScrolls };
  }

  function restoreScroll(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
      const kanban = qs(".cwl-kanban");
      if (kanban) {
        kanban.scrollLeft = snapshot.kanbanLeft || 0;
        kanban.scrollTop = snapshot.kanbanTop || 0;
      }
      Object.entries(snapshot.columnScrolls || {}).forEach(([columnId, top]) => {
        const zone = qs(`.cwl-dropzone[data-column-id="${CSS.escape(columnId)}"]`);
        if (zone) zone.scrollTop = top;
      });
    });
  }

  function render(options = {}) {
    if (!state) return;
    const snapshot = options.keepScroll ? captureScroll() : null;
    shiftWhatsApp();
    getRoot().innerHTML = `
      <aside class="cwl-shell ${drawerOpen ? "is-open" : "is-closed"}">
        ${renderSidebar()}
        ${drawerOpen ? renderPanel() : ""}
      </aside>
      ${feedback ? `<div class="cwl-toast">${esc(feedback)}</div>` : ""}
      ${renderModal()}
    `;
    restoreScroll(snapshot);
  }

  function renderSidebar() {
    return `
      <nav class="cwl-sidebar">
        <button class="cwl-brand" data-action="toggle-drawer"><span>CW</span>${drawerOpen ? "<strong>CODE Whats</strong>" : ""}</button>
        <div class="cwl-nav-list">
          ${navItems.map((item) => `<button class="cwl-nav-item ${activeView === item.id ? "is-active" : ""}" data-action="set-view" data-view="${item.id}"><span>${item.icon}</span>${drawerOpen ? `<strong>${item.label}</strong>` : ""}</button>`).join("")}
        </div>
      </nav>
    `;
  }

  function renderPanel() {
    return `
      <section class="cwl-panel">
        <header class="cwl-topbar"><div><p class="cwl-kicker">CRM local</p><h1>${esc(navItems.find((item) => item.id === activeView).label)}</h1></div><button class="cwl-icon-btn" data-action="toggle-drawer">‹</button></header>
        <section class="cwl-current-chat"><span>Contato ativo</span><strong>${esc(activeChat && activeChat.hasConversation ? activeChat.name : "Nenhuma conversa aberta")}</strong><small>${esc(activeChat && activeChat.hasConversation ? chatMeta(activeChat) : "Abra um chat para adicionar ao funil.")}</small></section>
        ${renderView()}
      </section>
    `;
  }

  function chatMeta(chat) {
    return [chat.phone, chat.lastMessageTime, `${chat.visibleMessageCount || 0} mensagens visiveis capturadas`].filter(Boolean).join(" • ");
  }

  function renderView() {
    if (activeView === "clients") return renderClients();
    if (activeView === "notes") return renderNotesView();
    if (activeView === "backup") return renderBackup();
    return renderKanban();
  }

  function renderFunnelControls() {
    return `<section class="cwl-toolbar"><label class="cwl-field"><span>Funil</span><select data-action="change-funnel">${state.funnels.map((funnel) => `<option value="${funnel.id}" ${funnel.id === activeFunnel().id ? "selected" : ""}>${esc(funnel.name)}</option>`).join("")}</select></label><button class="cwl-btn cwl-btn-ghost" data-action="new-funnel">Novo funil</button><button class="cwl-btn cwl-btn-ghost" data-action="new-column">Nova etapa</button></section>`;
  }

  function renderKanban() {
    return `${renderFunnelControls()}<section class="cwl-kanban-actions"><button class="cwl-btn cwl-btn-primary" data-action="open-crm-window">Nova janela</button></section><main class="cwl-kanban">${renderInboxColumn()}${activeFunnel().columns.map(renderColumn).join("")}</main>`;
  }

  function renderInboxColumn() {
    return `<section class="cwl-column cwl-inbox-column"><header><strong>Inbox WhatsApp</strong><span>${detectedChats.length}</span></header><div class="cwl-dropzone cwl-inbox-zone">${detectedChats.map(renderDetectedCard).join("") || `<p class="cwl-empty">Abra ou role a lista de chats do WhatsApp para detectar conversas.</p>`}</div></section>`;
  }

  function renderDetectedCard(chat) {
    return `<article class="cwl-card cwl-detected-card" draggable="true" data-detected-key="${esc(chat.key)}"><div class="cwl-card-top"><div><strong>${esc(chat.name)}</strong><span>${esc(chat.lastMessage || "Conversa detectada")}</span></div>${chat.unread ? `<em class="cwl-unread">${esc(chat.unread)}</em>` : ""}</div><div class="cwl-card-meta"><span>${esc(chat.lastMessageTime || "")}</span><span>Detectado</span></div></article>`;
  }

  function renderColumn(column) {
    const clients = activeClients().filter((client) => client.columnId === column.id);
    return `<section class="cwl-column" data-column-id="${column.id}"><header><input class="cwl-column-title" data-action="rename-column" data-column-id="${column.id}" value="${esc(column.name)}"><span>${clients.length}</span><button data-action="delete-column" data-column-id="${column.id}">×</button></header><div class="cwl-dropzone" data-column-id="${column.id}">${clients.map(renderClientCard).join("") || `<p class="cwl-empty">Arraste uma conversa para esta etapa.</p>`}</div></section>`;
  }

  function renderClientCard(client) {
    return `<article class="cwl-card ${client.reminders.some(isPastDue) ? "has-alert" : ""}" draggable="true" data-client-id="${client.id}"><div class="cwl-card-top"><div><strong>${esc(client.name)}</strong><span>${esc(client.phone || client.chatTitle || "Cliente CRM")}</span></div><em class="cwl-temp cwl-temp-${client.temperature}">${esc(client.temperature)}</em></div>${client.nextAction ? `<p class="cwl-next">${esc(client.nextAction)}</p>` : ""}<div class="cwl-card-actions"><button data-action="open-profile" data-client-id="${client.id}">Perfil</button><button data-action="open-client-chat" data-client-id="${client.id}">Chat</button></div></article>`;
  }

  function renderClients() {
    return `<section class="cwl-client-list"><h2>Fixados locais</h2>${pinnedClients().map(renderClientRow).join("") || `<p class="cwl-empty">Nenhum fixado local.</p>`}<h2>Clientes CRM</h2>${state.clients.map(renderClientRow).join("") || `<p class="cwl-empty">Nenhum cliente salvo no CRM.</p>`}<h2>Conversas detectadas</h2>${detectedChats.map(renderDetectedRow).join("") || `<p class="cwl-empty">Nenhuma conversa visivel detectada.</p>`}</section>`;
  }

  function renderClientRow(client) {
    return `<article class="cwl-row ${client.reminders.some(isPastDue) ? "has-alert" : ""}"><button data-action="open-profile" data-client-id="${client.id}"><strong>${esc(client.name)}</strong><span>${esc(client.phone || client.chatTitle || client.waKey)}</span></button><button data-action="context-note" data-client-id="${client.id}">Notas</button><button data-action="open-client-chat" data-client-id="${client.id}">Chat</button><button data-action="toggle-pin" data-client-id="${client.id}">${client.pinned ? "Desafixar" : "Fixar"}</button></article>`;
  }

  function renderDetectedRow(chat) {
    return `<article class="cwl-row"><button data-action="add-detected" data-detected-key="${esc(chat.key)}"><strong>${esc(chat.name)}</strong><span>${esc(chat.lastMessage || "Conversa detectada")}</span></button><button data-action="add-detected" data-detected-key="${esc(chat.key)}">Adicionar</button></article>`;
  }

  function renderNotesView() {
    const client = selectedClient();
    if (!client) return `<section class="cwl-card-panel"><p class="cwl-empty">Selecione ou adicione um contato ao CRM para criar notas.</p></section>`;
    return `<section class="cwl-card-panel"><h2>${esc(client.name)}</h2><button class="cwl-btn cwl-btn-primary" data-action="context-note" data-client-id="${client.id}">Nova nota</button>${renderNotes(client)}${renderReminders(client)}</section>`;
  }

  function renderBackup() {
    return `<section class="cwl-card-panel"><h2>Backup local</h2><p>Exporta funis, etapas, clientes, notas, lembretes e fixados.</p><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-primary" data-action="export-backup">Exportar JSON</button><button class="cwl-btn cwl-btn-ghost" data-action="import-backup">Importar JSON</button></div><input class="cwl-file-input" type="file" accept="application/json" data-role="backup-file"></section>`;
  }

  function renderModal() {
    if (!modal) return "";
    if (modal.type === "add") return renderAddModal();
    if (modal.type === "profile") return renderProfileModal();
    if (modal.type === "reminder") return renderReminderModal();
    return "";
  }

  function renderAddModal() {
    const chat = modal.chat || activeChat;
    const funnel = state.funnels.find((item) => item.id === (modal.funnelId || state.activeFunnelId)) || activeFunnel();
    return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="add-form"><header><h2>Adicionar ao funil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><div class="cwl-form-grid">${input("Nome", "name", chat.name, "text", true)}${input("Telefone", "phone", chat.phone || "", "tel")}<label class="cwl-field"><span>Funil</span><select name="funnelId" data-action="modal-funnel-change">${state.funnels.map((item) => `<option value="${item.id}" ${item.id === funnel.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label class="cwl-field"><span>Etapa</span><select name="columnId">${funnel.columns.map((column) => `<option value="${column.id}">${esc(column.name)}</option>`).join("")}</select></label>${input("Novo funil", "newFunnel", "")}${input("Nova etapa", "newColumn", "")}<label class="cwl-field cwl-field-wide"><span>Observacoes</span><textarea name="note" rows="3">${esc(chat.lastMessage || "")}</textarea></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar</button></footer></form></div>`;
  }

  function renderProfileModal() {
    const client = state.clients.find((item) => item.id === modal.clientId) || findClientForChat(activeChat);
    const captured = (client && client.captured) || activeChat || {};
    return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="profile-form"><header><h2>Perfil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><section class="cwl-captured-grid">${info("Nome", (client && client.name) || captured.name || "nao encontrado")}${info("Telefone", (client && client.phone) || captured.phone || "nao encontrado")}${info("Foto", captured.photo ? "encontrada" : "nao encontrada")}${info("Ultima mensagem", captured.lastMessage || "nao encontrada")}${info("Horario", captured.lastMessageTime || "nao encontrado")}</section>${client ? `<input type="hidden" name="clientId" value="${esc(client.id)}"><div class="cwl-form-grid"><label class="cwl-field cwl-field-wide"><span>Observacoes</span><textarea name="note" rows="3">${esc(client.note)}</textarea></label><label class="cwl-field"><span>Temperatura</span><select name="temperature">${["frio", "morno", "quente"].map((temp) => `<option value="${temp}" ${client.temperature === temp ? "selected" : ""}>${temp}</option>`).join("")}</select></label>${input("Valor estimado", "value", client.value, "number")}${input("Proxima acao", "nextAction", client.nextAction)}${input("Etiquetas", "tags", (client.tags || []).join(", "))}</div>${renderNotes(client)}${renderReminders(client)}<footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar perfil</button></footer>` : `<p class="cwl-empty">Este contato ainda nao esta no CRM. Use Adicionar ao funil primeiro.</p>`}</form></div>`;
  }

  function renderReminderModal() {
    return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="reminder-form"><header><h2>Criar lembrete</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><div class="cwl-form-grid">${input("Titulo", "title", "", "text", true)}${input("Data/hora", "dueAt", "", "datetime-local")}<label class="cwl-field cwl-field-wide"><span>Observacao</span><textarea name="note" rows="3"></textarea></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar</button></footer></form></div>`;
  }

  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;
  const info = (label, value) => `<article><span>${label}</span><strong>${esc(value)}</strong></article>`;
  const renderNotes = (client) => client.notes.length ? `<h3>Notas</h3><ul class="cwl-history">${client.notes.map((note) => `<li><span>${new Date(note.createdAt).toLocaleString("pt-BR")}</span>${esc(note.text)}</li>`).join("")}</ul>` : `<h3>Notas</h3><p class="cwl-empty">Sem notas.</p>`;
  const renderReminders = (client) => client.reminders.length ? `<h3>Lembretes</h3><ul class="cwl-history">${client.reminders.map((reminder) => `<li class="${isPastDue(reminder) ? "is-overdue" : ""}"><span>${esc(reminder.dueAt || "Sem data")}</span><strong>${esc(reminder.title)}</strong>${reminder.note ? `<p>${esc(reminder.note)}</p>` : ""}</li>`).join("")}</ul>` : `<h3>Lembretes</h3><p class="cwl-empty">Sem lembretes.</p>`;

  async function saveUi() {
    state.drawerOpen = drawerOpen;
    state.activeView = activeView;
    state = await storage.saveState(state);
  }

  async function saveChatAsClient(chat, funnelId, columnId, extra = {}) {
    state = await storage.upsertClient({
      funnelId,
      columnId,
      name: extra.name || chat.name,
      phone: extra.phone || chat.phone || "",
      chatTitle: chat.chatTitle || chat.name,
      photo: chat.photo || "",
      waKey: chat.waKey || chat.key,
      tags: ["WhatsApp"],
      note: extra.note || chat.lastMessage || "",
      captured: chat
    });
    const saved = findClientForChat(chat) || state.clients.find((client) => client.name === (extra.name || chat.name));
    if (saved) selectedClientId = saved.id;
  }

  async function ensureCurrentClient() {
    let client = findClientForChat(activeChat);
    if (client) return client;
    const funnel = activeFunnel();
    await saveChatAsClient(activeChat, funnel.id, funnel.columns[0].id);
    return selectedClient();
  }

  function showFeedback(message) {
    feedback = message;
    render({ keepScroll: true });
    setTimeout(() => { feedback = ""; render({ keepScroll: true }); }, 2200);
  }

  function openChatNatively(clientOrChat) {
    const terms = [clientOrChat.chatTitle, clientOrChat.name, clientOrChat.phone].map(clean).filter(Boolean);
    const rows = qsa('div[role="row"], [data-testid="cell-frame-container"]');
    for (const row of rows) {
      const text = clean(row.textContent).toLowerCase();
      if (terms.some((term) => text.includes(term.toLowerCase()))) {
        row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        row.click();
        return true;
      }
    }
    const phone = phoneOnly(clientOrChat.phone);
    if (phone) location.assign(`https://web.whatsapp.com/send?phone=${phone}`);
    return false;
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `code-whats-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleClick(event) {
    if (event.target.closest(".cwl-modal")) event.stopPropagation();
    const target = event.target.closest("[data-action], .cwl-card");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-drawer") { drawerOpen = !drawerOpen; await saveUi(); render({ keepScroll: true }); return; }
    if (action === "set-view") { activeView = target.dataset.view; await saveUi(); render({ keepScroll: true }); return; }
    if (action === "open-add-current") { if (activeChat && activeChat.hasConversation) modal = { type: "add", chat: activeChat, funnelId: state.activeFunnelId }; render(); return; }
    if (action === "add-detected") { const chat = detectedChats.find((item) => item.key === target.dataset.detectedKey); if (chat) modal = { type: "add", chat, funnelId: state.activeFunnelId }; render(); return; }
    if (action === "show-current-profile") { const client = findClientForChat(activeChat); modal = { type: "profile", clientId: client && client.id }; render(); return; }
    if (action === "open-profile") { selectedClientId = target.dataset.clientId; modal = { type: "profile", clientId: target.dataset.clientId }; render(); return; }
    if (action === "open-reminder-modal") { const client = await ensureCurrentClient(); modal = { type: "reminder", clientId: client && client.id }; render(); return; }
    if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render({ keepScroll: true }); } return; }
    if (action === "context-note") { const client = target.dataset.clientId ? state.clients.find((item) => item.id === target.dataset.clientId) : await ensureCurrentClient(); const text = prompt("Nota para este contato:"); if (client && text) state = await storage.addNote(client.id, text); render(); return; }
    if (action === "pin-current-chat") { const client = await ensureCurrentClient(); if (client) state = await storage.togglePinned(client.id); render({ keepScroll: true }); return; }
    if (action === "toggle-pin") { state = await storage.togglePinned(target.dataset.clientId); render({ keepScroll: true }); return; }
    if (action === "new-funnel") { const name = prompt("Nome do novo funil:"); if (name) state = await storage.createFunnel(name); render({ keepScroll: true }); return; }
    if (action === "new-column") { const name = prompt("Nome da nova etapa:"); if (name) state = await storage.createColumn(activeFunnel().id, name); render({ keepScroll: true }); return; }
    if (action === "delete-column") { if (confirm("Excluir esta etapa? Os cards serao movidos para outra etapa.")) state = await storage.deleteColumn(activeFunnel().id, target.dataset.columnId); render({ keepScroll: true }); return; }
    if (action === "open-client-chat") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatNatively(client); return; }
    if (action === "open-crm-window") { chrome.runtime.sendMessage({ type: "CWL_OPEN_CRM_WINDOW" }); return; }
    if (action === "export-backup") { downloadBackup(); return; }
    if (action === "import-backup") { qs('[data-role="backup-file"]').click(); return; }
    if (target.classList.contains("cwl-card") && target.dataset.clientId) { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatNatively(client); }
  }

  async function handleChange(event) {
    if (event.target.closest(".cwl-modal")) event.stopPropagation();
    if (event.target.matches('[data-action="change-funnel"]')) { state.activeFunnelId = event.target.value; state = await storage.saveState(state); render({ keepScroll: true }); }
    if (event.target.matches('[data-action="modal-funnel-change"]')) { modal.funnelId = event.target.value; render(); }
    if (event.target.matches('[data-role="backup-file"]') && event.target.files[0]) {
      try { state = await storage.importState(JSON.parse(await event.target.files[0].text())); render(); }
      catch (error) { alert("Nao foi possivel importar o backup. Verifique se o JSON e valido."); }
    }
  }

  function handleInput(event) {
    if (event.target.closest(".cwl-modal")) event.stopPropagation();
    if (!event.target.matches('[data-action="rename-column"]')) return;
    clearTimeout(event.target._cwlTimer);
    const inputEl = event.target;
    inputEl._cwlTimer = setTimeout(async () => { state = await storage.renameColumn(activeFunnel().id, inputEl.dataset.columnId, inputEl.value); }, 450);
  }

  async function handleSubmit(event) {
    if (event.target.matches('[data-role="add-form"]')) { event.preventDefault(); await submitAdd(event.target); }
    if (event.target.matches('[data-role="profile-form"]')) { event.preventDefault(); await submitProfile(event.target); }
    if (event.target.matches('[data-role="reminder-form"]')) { event.preventDefault(); await submitReminder(event.target); }
  }

  async function submitAdd(form) {
    const data = new FormData(form);
    let funnelId = data.get("funnelId");
    if (clean(data.get("newFunnel"))) { state = await storage.createFunnel(data.get("newFunnel")); funnelId = state.activeFunnelId; }
    if (clean(data.get("newColumn"))) state = await storage.createColumn(funnelId, data.get("newColumn"));
    const funnel = state.funnels.find((item) => item.id === funnelId);
    const columnId = clean(data.get("newColumn")) ? funnel.columns[funnel.columns.length - 1].id : data.get("columnId");
    await saveChatAsClient(modal.chat, funnelId, columnId, { name: data.get("name"), phone: data.get("phone"), note: data.get("note") });
    state = await storage.getState();
    modal = null;
    activeView = "kanban";
    showFeedback("Cliente adicionado ao funil");
  }

  async function submitProfile(form) {
    const data = new FormData(form);
    const client = state.clients.find((item) => item.id === data.get("clientId"));
    if (client) state = await storage.upsertClient({ ...client, note: data.get("note"), temperature: data.get("temperature"), value: data.get("value"), nextAction: data.get("nextAction"), tags: clean(data.get("tags")).split(",").map(clean).filter(Boolean) });
    modal = null;
    render({ keepScroll: true });
  }

  async function submitReminder(form) {
    const data = new FormData(form);
    const client = state.clients.find((item) => item.id === modal.clientId) || await ensureCurrentClient();
    if (client) state = await storage.addReminder(client.id, { title: data.get("title"), dueAt: data.get("dueAt"), note: data.get("note") });
    modal = null;
    render({ keepScroll: true });
  }

  function handleDragStart(event) {
    isInteracting = true;
    const card = event.target.closest(".cwl-card");
    if (!card) { isInteracting = false; return; }
    if (card.dataset.clientId) event.dataTransfer.setData("application/cwl-client", card.dataset.clientId);
    if (card.dataset.detectedKey) event.dataTransfer.setData("application/cwl-detected", card.dataset.detectedKey);
    card.classList.add("is-dragging");
  }

  function handleDragEnd(event) { isInteracting = false; const card = event.target.closest(".cwl-card"); if (card) card.classList.remove("is-dragging"); }
  function handleDragOver(event) { const zone = event.target.closest(".cwl-dropzone"); if (zone && !zone.classList.contains("cwl-inbox-zone")) { event.preventDefault(); zone.classList.add("is-over"); } }
  function handleDragLeave(event) { const zone = event.target.closest(".cwl-dropzone"); if (zone) zone.classList.remove("is-over"); }
  async function handleDrop(event) {
    const zone = event.target.closest(".cwl-dropzone");
    if (!zone || zone.classList.contains("cwl-inbox-zone")) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const clientId = event.dataTransfer.getData("application/cwl-client");
    const detectedKey = event.dataTransfer.getData("application/cwl-detected");
    if (clientId) state = await storage.moveClient(clientId, zone.dataset.columnId);
    if (detectedKey) {
      const chat = detectedChats.find((item) => item.key === detectedKey);
      if (chat) await saveChatAsClient(chat, activeFunnel().id, zone.dataset.columnId);
    }
    state = await storage.getState();
    render({ keepScroll: true });
  }

  function bindEvents() {
    document.addEventListener("click", handleClick, true);
    document.addEventListener("change", handleChange, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("mousedown", (event) => { if (event.target.closest(".cwl-modal, .cwl-native-actions, #code-whats-local-root")) event.stopPropagation(); }, true);
    document.addEventListener("keydown", (event) => { if (event.target.closest(".cwl-modal")) event.stopPropagation(); }, true);
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
  }

  function bootObserver() {
    observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(() => scanWhatsApp(false), 1000); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(() => scanWhatsApp(false), 6000);
  }

  async function boot() {
    state = await storage.getState();
    drawerOpen = state.drawerOpen !== false;
    activeView = navItems.some((item) => item.id === state.activeView) ? state.activeView : "kanban";
    activeChat = getActiveChatContext();
    detectedChats = getDetectedChats();
    bindEvents();
    bootObserver();
    injectHeaderActions();
    render();
    scheduleDetectedPersist();
  }

  boot();
})();






