(function () {
  if (window.__codeWhatsLocalLiteLoaded) return;
  window.__codeWhatsLocalLiteLoaded = true;

  const storage = window.CodeWhatsStorage;
  const navItems = [
    { id: "crm", icon: "P", label: "Pipeline" },
    { id: "clients", icon: "C", label: "Clientes" },
    { id: "notes", icon: "N", label: "Notas" },
    { id: "backup", icon: "B", label: "Backup" },
    { id: "sync", icon: "S", label: "Sincronizacao" }
  ];

  let state = null;
  let drawerOpen = true;
  let activeView = "clients";
  let modal = null;
  let selectedClientId = "";
  let activeChat = null;
  let detectedChats = [];
  let scanTimer = null;
  let persistTimer = null;
  let lastSignature = "";
  let feedback = "";

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const phoneOnly = (value) => clean(value).replace(/\D/g, "");

  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const selectedClient = () => state.clients.find((client) => client.id === selectedClientId) || findClientForChat(activeChat) || null;
  const pinnedClients = () => state.pinnedClientIds.map((id) => state.clients.find((client) => client.id === id)).filter(Boolean);
  const notesFor = (clientId) => state.notas.filter((note) => note.clienteId === clientId || note.clientId === clientId);
  const remindersFor = (clientId) => state.lembretes.filter((reminder) => reminder.clienteId === clientId || reminder.clientId === clientId);

  function getConversationHeader() { return qs('header[data-testid="conversation-header"]') || (qs("main") && qs("main").querySelector("header")); }

  function getActiveChatContext() {
    const header = getConversationHeader();
    if (!header) return { hasConversation: false };
    const nameNode = qs("#chatName", header) || qs('[data-testid="conversation-info-header-chat-title"]', header) || qs('span[title]', header) || qs('span[dir="auto"]', header);
    const name = clean(nameNode && (nameNode.getAttribute("title") || nameNode.textContent));
    const photoNode = qs("img", header);
    const photo = photoNode ? clean(photoNode.src) : "";
    const phoneMatch = clean(header.textContent).match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = phoneOnly(phoneMatch && phoneMatch[0]);
    const main = qs("main") || document.body;
    const messages = qsa('div[data-pre-plain-text], div.message-in, div.message-out, div[role="row"]', main).filter((node) => clean(node.textContent));
    const lastNode = messages[messages.length - 1];
    const pre = lastNode && lastNode.getAttribute("data-pre-plain-text");
    const timeMatch = pre && pre.match(/\[(.*?)\]/);
    const ultimoContato = timeMatch ? timeMatch[1] : "";
    const ultimaMensagem = clean(lastNode && lastNode.textContent).slice(0, 360);
    const waKey = phone || [name, photo ? photo.slice(-32) : "no-photo", ultimoContato || String(messages.length)].filter(Boolean).join("|");
    return { hasConversation: Boolean(name), key: waKey, waKey, name, nome: name, chatTitle: name, phone, telefone: phone, photo, foto: photo, lastMessage: ultimaMensagem, ultimaMensagem, lastMessageTime: ultimoContato, ultimoContato, visibleMessageCount: messages.length, capturedAt: new Date().toISOString() };
  }

  function stripChatNoise(value) { return clean(value).replace(/wds-ic-[\w-]+/gi, "").replace(/ic-push-pin|archive-refreshed|status-dblcheck|message-dblcheck/gi, "").replace(/Arquivadas\d*/gi, "").replace(/\b\d+ mensagens? n[aã]o lidas?\b/gi, ""); }
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
    return { key, waKey: key, name, nome: name, chatTitle: name, phone: "", telefone: "", photo, foto: photo, lastMessage, ultimaMensagem: lastMessage, lastMessageTime, ultimoContato: lastMessageTime, unread, capturedAt: new Date().toISOString() };
  }

  function getDetectedChats() {
    const rows = qsa('div[role="row"], [data-testid="cell-frame-container"]');
    const seen = new Set();
    const chats = [];
    rows.forEach((row, index) => { const chat = parseChatListItem(row, index); if (!chat) return; const key = chat.name.toLowerCase(); if (seen.has(key)) return; seen.add(key); chats.push(chat); });
    return chats.slice(0, 80);
  }

  function findClientForChat(chat) {
    if (!chat) return null;
    const key = chat.waKey || chat.key;
    const phone = phoneOnly(chat.phone || chat.telefone);
    const title = clean(chat.chatTitle || chat.name || chat.nome).toLowerCase();
    return state.clients.find((client) => (phone && phoneOnly(client.phone || client.telefone) === phone) || (key && client.waKey === key) || (title && clean(client.chatTitle || client.name || client.nome).toLowerCase() === title));
  }

  function scanWhatsApp(force = false) {
    if (modal) return;
    const nextActive = getActiveChatContext();
    const nextDetected = getDetectedChats();
    const signature = JSON.stringify({ active: nextActive.waKey, count: nextDetected.length, names: nextDetected.slice(0, 12).map((chat) => `${chat.name}:${chat.lastMessageTime}`) });
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    activeChat = nextActive;
    detectedChats = nextDetected;
    injectHeaderActions();
    scheduleDetectedPersist();
    render();
  }

  function scheduleDetectedPersist() { clearTimeout(persistTimer); persistTimer = setTimeout(async () => { state = await storage.saveDetectedChats(detectedChats); }, 1000); }

  function injectHeaderActions() {
    const header = getConversationHeader();
    if (!header || !activeChat || !activeChat.hasConversation) { qsa(".cwl-native-actions").forEach((node) => node.remove()); return; }
    let actions = qs(".cwl-native-actions", header);
    if (!actions) { actions = document.createElement("div"); actions.className = "cwl-native-actions"; header.appendChild(actions); }
    actions.innerHTML = `<span>CODE</span><button data-action="open-add-current">Adicionar ao funil</button><button data-action="show-current-profile">Perfil</button><button data-action="context-note">Nota</button><button data-action="open-reminder-modal">Lembrete</button><button data-action="pin-current-chat">Fixar local</button>`;
  }

  function getRoot() { let root = qs("#code-whats-local-root"); if (!root) { root = document.createElement("div"); root.id = "code-whats-local-root"; document.body.appendChild(root); } return root; }
  function shiftWhatsApp() { const app = qs("#app") || document.body; const width = drawerOpen ? "360px" : "72px"; document.documentElement.style.setProperty("--cwl-drawer-width", width); app.style.setProperty("--cwl-drawer-width", width); app.classList.add("cwl-whatsapp-shifted"); }
  function showFeedback(message) { feedback = message; render(); setTimeout(() => { feedback = ""; render(); }, 2200); }

  function render() {
    if (!state) return;
    shiftWhatsApp();
    getRoot().innerHTML = `<aside class="cwl-shell ${drawerOpen ? "is-open" : "is-closed"}">${renderSidebar()}${drawerOpen ? renderPanel() : ""}</aside>${feedback ? `<div class="cwl-toast">${esc(feedback)}</div>` : ""}${renderModal()}`;
  }
  function renderSidebar() { return `<nav class="cwl-sidebar"><button class="cwl-brand" data-action="toggle-drawer"><span>CW</span>${drawerOpen ? "<strong>CODE Whats</strong>" : ""}</button><div class="cwl-nav-list">${navItems.map((item) => `<button class="cwl-nav-item ${activeView === item.id ? "is-active" : ""}" data-action="set-view" data-view="${item.id}"><span>${item.icon}</span>${drawerOpen ? `<strong>${item.label}</strong>` : ""}</button>`).join("")}</div></nav>`; }
  function renderPanel() { const item = navItems.find((nav) => nav.id === activeView) || navItems[1]; return `<section class="cwl-panel"><header class="cwl-topbar"><div><p class="cwl-kicker">Painel operacional</p><h1>${esc(item.label)}</h1></div><button class="cwl-icon-btn" data-action="toggle-drawer">‹</button></header><section class="cwl-current-chat"><span>Contato ativo</span><strong>${esc(activeChat && activeChat.hasConversation ? activeChat.name : "Nenhuma conversa aberta")}</strong><small>${esc(activeChat && activeChat.hasConversation ? `${activeChat.visibleMessageCount || 0} mensagens visiveis capturadas` : "Abra um chat para usar as acoes do header.")}</small></section>${renderView()}</section>`; }
  function renderView() { if (state.syncMode === "code" && !state.codeUser) return renderCodeLogin(); if (activeView === "crm") return renderCrmShortcut(); if (activeView === "notes") return renderNotesView(); if (activeView === "backup") return renderBackup(); if (activeView === "sync") return renderSyncPanel(); return renderClients(); }
    function renderCodeLogin() { return `<section class="cwl-card-panel"><h2>Login CODE Imob</h2><p>Faça login na CODE Imob para sincronizar leads, funis e clientes.</p><form data-role="code-login-form" class="cwl-login-form">${input("E-mail", "email", "", "email", true)}${input("Senha", "password", "", "password", true)}<button class="cwl-btn cwl-btn-primary" type="submit">Entrar</button></form></section>`; }
  function renderSyncPanel() { const pending = state.syncEvents.filter((event) => event.syncStatus === "pending").length; return `<section class="cwl-card-panel"><h2>Sincronização</h2><p>Modo atual: <strong>${state.syncMode === "code" ? "CODE Sync" : "Local"}</strong></p>${state.codeUser ? `<p>Usuário: ${esc(state.codeUser.email)}</p>` : `<p>Nenhum usuário logado.</p>`}<p>Eventos pendentes: ${pending}</p><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-ghost" data-action="set-local-mode">Modo Local</button><button class="cwl-btn cwl-btn-primary" data-action="set-code-mode">CODE Sync</button><button class="cwl-btn cwl-btn-ghost" data-action="simulate-sync">Simular sincronização</button><button class="cwl-btn cwl-btn-ghost" data-action="logout-code">Sair</button></div></section>`; }
  function renderCrmShortcut() { return `<section class="cwl-card-panel"><h2>Pipeline completo</h2><p>O CRM completo abre em uma janela separada.</p><button class="cwl-btn cwl-btn-primary" data-action="open-crm-window">Abrir CRM</button></section>`; }
  function renderClients() { return `<section class="cwl-client-list"><button class="cwl-btn cwl-btn-primary cwl-full-btn" data-action="open-crm-window">Abrir CRM completo</button><h2>Fixados locais</h2>${pinnedClients().map(renderClientRow).join("") || `<p class="cwl-empty">Nenhum fixado local.</p>`}<h2>Clientes CRM</h2>${state.clients.slice(0, 25).map(renderClientRow).join("") || `<p class="cwl-empty">Nenhum cliente salvo no CRM.</p>`}<h2>Conversas detectadas</h2>${detectedChats.slice(0, 20).map(renderDetectedRow).join("") || `<p class="cwl-empty">Nenhuma conversa visivel detectada.</p>`}</section>`; }
  function renderClientRow(client) { return `<article class="cwl-row"><button data-action="show-client-profile" data-client-id="${client.id}"><strong>${esc(client.name || client.nome)}</strong><span>${esc(client.phone || client.telefone || client.waKey)}</span></button><button data-action="context-note" data-client-id="${client.id}">Nota</button><button data-action="open-client-chat" data-client-id="${client.id}">Chat</button><button data-action="toggle-pin" data-client-id="${client.id}">${client.pinned ? "Desafixar" : "Fixar"}</button></article>`; }
  function renderDetectedRow(chat) { return `<article class="cwl-row"><button data-action="open-add-detected" data-detected-key="${esc(chat.key)}"><strong>${esc(chat.name)}</strong><span>${esc(chat.lastMessage || "Conversa detectada")}</span></button><button data-action="open-add-detected" data-detected-key="${esc(chat.key)}">Adicionar</button></article>`; }
  function renderNotesView() { const client = selectedClient(); if (!client) return `<section class="cwl-card-panel"><p class="cwl-empty">Selecione ou adicione um contato ao CRM para criar notas.</p></section>`; return `<section class="cwl-card-panel"><h2>${esc(client.name || client.nome)}</h2><button class="cwl-btn cwl-btn-primary" data-action="context-note" data-client-id="${client.id}">Nova nota</button>${notesFor(client.id).length ? `<ul class="cwl-history">${notesFor(client.id).map((note) => `<li><span>${new Date(note.createdAt).toLocaleString("pt-BR")}</span>${esc(note.text)}</li>`).join("")}</ul>` : `<p class="cwl-empty">Sem notas.</p>`}</section>`; }
  function renderBackup() { return `<section class="cwl-card-panel"><h2>Backup local</h2><p>Exporta funis, etapas, clientes, notas, lembretes, fixados e templates de mensagens.</p><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-primary" data-action="export-backup">Exportar JSON</button><button class="cwl-btn cwl-btn-ghost" data-action="import-backup">Importar JSON</button></div><input class="cwl-file-input" type="file" accept="application/json" data-role="backup-file"></section>`; }

  function renderModal() { if (!modal) return ""; if (modal.type === "add") return renderAddModal(); if (modal.type === "profile") return renderProfileModal(); if (modal.type === "reminder") return renderReminderModal(); return ""; }
  function renderAddModal() { const chat = modal.chat || activeChat; const funil = state.funis.find((item) => item.id === (modal.funilId || state.activeFunnelId)) || state.funis[0]; return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="add-form"><header><h2>Adicionar ao funil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><div class="cwl-form-grid">${input("Nome", "nome", chat.name || chat.nome, "text", true)}${input("Telefone", "telefone", chat.phone || chat.telefone || "", "tel")}<label class="cwl-field"><span>Funil</span><select name="funilId" data-action="modal-funnel-change">${state.funis.map((item) => `<option value="${item.id}" ${item.id === funil.id ? "selected" : ""}>${esc(item.nome)}</option>`).join("")}</select></label><label class="cwl-field"><span>Etapa</span><select name="etapaId">${funil.etapas.map((etapa) => `<option value="${etapa.id}">${esc(etapa.nome)}</option>`).join("")}</select></label><label class="cwl-field cwl-field-wide"><span>Observacoes</span><textarea name="observacao" rows="3">${esc(chat.lastMessage || chat.ultimaMensagem || "")}</textarea></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar</button></footer></form></div>`; }
  function renderProfileModal() { const client = state.clients.find((item) => item.id === modal.clientId) || findClientForChat(activeChat); return `<div class="cwl-modal-backdrop" data-action="close-modal"><section class="cwl-modal"><header><h2>Perfil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>${client ? `<section class="cwl-captured-grid"><article><span>Nome</span><strong>${esc(client.name || client.nome)}</strong></article><article><span>Telefone</span><strong>${esc(client.phone || client.telefone || "nao encontrado")}</strong></article><article><span>Ultima mensagem</span><strong>${esc(client.lastMessage || client.ultimaMensagem || "nao encontrada")}</strong></article><article><span>Ultimo contato</span><strong>${esc(client.lastMessageTime || client.ultimoContato || "nao encontrado")}</strong></article></section>` : `<p class="cwl-empty">Este contato ainda nao esta no CRM.</p>`}</section></div>`; }
  function renderReminderModal() { return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="reminder-form"><header><h2>Criar lembrete</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><div class="cwl-form-grid">${input("Titulo", "title", "", "text", true)}${input("Data/hora", "dueAt", "", "datetime-local")}<label class="cwl-field cwl-field-wide"><span>Observacao</span><textarea name="note" rows="3"></textarea></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar</button></footer></form></div>`; }
  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;

  async function saveUi() { state.drawerOpen = drawerOpen; state.activeView = activeView; state = await storage.saveState(state); }
  async function ensureCurrentClient() { let client = findClientForChat(activeChat); if (client) return client; const funil = activeFunnel(); state = await storage.upsertClient({ nome: activeChat.name, telefone: activeChat.phone || "", funilId: funil.id, etapaId: funil.columns[0].id, waKey: activeChat.waKey, origem: "whatsapp", ultimaMensagem: activeChat.lastMessage, ultimoContato: activeChat.lastMessageTime, captured: activeChat }); return findClientForChat(activeChat); }
  function downloadBackup() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `code-whats-local-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); }
  function openChatNatively(client) { const phone = phoneOnly(client.telefone || client.phone); if (phone) { location.assign(`https://web.whatsapp.com/send?phone=${phone}`); return true; } const terms = [client.nome, client.name, client.chatTitle].map(clean).filter(Boolean); for (const row of qsa('div[role="row"], [data-testid="cell-frame-container"]')) { const text = clean(row.textContent).toLowerCase(); if (terms.some((term) => text.includes(term.toLowerCase()))) { row.click(); return true; } } return false; }

  async function handleClick(event) {
    if (event.target.closest(".cwl-modal")) event.stopPropagation();
    const target = event.target.closest("[data-action]"); if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-drawer") { drawerOpen = !drawerOpen; await saveUi(); render(); return; }
    if (action === "set-view") { activeView = target.dataset.view; if (activeView === "crm") { chrome.runtime.sendMessage({ type: "CWL_OPEN_CRM_WINDOW" }); } await saveUi(); render(); return; }
    if (action === "open-crm-window") { chrome.runtime.sendMessage({ type: "CWL_OPEN_CRM_WINDOW" }); return; }
    if (action === "open-add-current") { if (activeChat && activeChat.hasConversation) modal = { type: "add", chat: activeChat, funilId: state.activeFunnelId }; render(); return; }
    if (action === "open-add-detected") { const chat = detectedChats.find((item) => item.key === target.dataset.detectedKey); if (chat) modal = { type: "add", chat, funilId: state.activeFunnelId }; render(); return; }
    if (action === "show-current-profile") { const client = findClientForChat(activeChat); modal = { type: "profile", clientId: client && client.id }; render(); return; }
    if (action === "show-client-profile") { selectedClientId = target.dataset.clientId; modal = { type: "profile", clientId: target.dataset.clientId }; render(); return; }
    if (action === "open-reminder-modal") { const client = await ensureCurrentClient(); modal = { type: "reminder", clientId: client && client.id }; render(); return; }
    if (action === "context-note") { const client = target.dataset.clientId ? state.clients.find((item) => item.id === target.dataset.clientId) : await ensureCurrentClient(); const text = prompt("Nota para este contato:"); if (client && text) state = await storage.addNote(client.id, text); render(); return; }
    if (action === "pin-current-chat") { const client = await ensureCurrentClient(); if (client) state = await storage.togglePinned(client.id); render(); return; }
    if (action === "toggle-pin") { state = await storage.togglePinned(target.dataset.clientId); render(); return; }
    if (action === "open-client-chat") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) { await storage.addSyncEvent({ type: "client_opened_whatsapp", contactId: client.id, payload: { source: "drawer" } }); openChatNatively(client); } return; }
    if (action === "set-local-mode") { state = await storage.setSyncMode("local"); render(); return; }
    if (action === "set-code-mode") { state = await storage.setSyncMode("code"); render(); return; }
    if (action === "simulate-sync") { state = await storage.simulateSync(); render(); return; }
    if (action === "logout-code") { state = await storage.logoutCode(); render(); return; }
    if (action === "export-backup") { downloadBackup(); return; }
    if (action === "import-backup") { qs('[data-role="backup-file"]').click(); return; }
    if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render(); } return; }
  }

  async function handleChange(event) { if (event.target.closest(".cwl-modal")) event.stopPropagation(); if (event.target.matches('[data-action="modal-funnel-change"]')) { modal.funilId = event.target.value; render(); } if (event.target.matches('[data-role="backup-file"]') && event.target.files[0]) { try { state = await storage.importState(JSON.parse(await event.target.files[0].text())); render(); } catch (error) { alert("Nao foi possivel importar o backup."); } } }
  async function handleSubmit(event) { if (event.target.matches('[data-role="code-login-form"]')) { event.preventDefault(); const data = new FormData(event.target); state = await storage.loginCode(data.get("email")); render(); return; } if (event.target.matches('[data-role="add-form"]')) { event.preventDefault(); event.stopPropagation(); const data = new FormData(event.target); state = await storage.upsertClient({ nome: data.get("nome"), telefone: data.get("telefone"), funilId: data.get("funilId"), etapaId: data.get("etapaId"), waKey: (modal.chat.waKey || modal.chat.key), origem: "whatsapp", observacao: data.get("observacao"), ultimaMensagem: modal.chat.lastMessage || modal.chat.ultimaMensagem, ultimoContato: modal.chat.lastMessageTime || modal.chat.ultimoContato, captured: modal.chat }); modal = null; showFeedback("Cliente adicionado ao funil"); } if (event.target.matches('[data-role="reminder-form"]')) { event.preventDefault(); event.stopPropagation(); const data = new FormData(event.target); const client = state.clients.find((item) => item.id === modal.clientId) || await ensureCurrentClient(); if (client) state = await storage.addReminder(client.id, { title: data.get("title"), dueAt: data.get("dueAt"), note: data.get("note") }); modal = null; render(); } }

  function bindEvents() { document.addEventListener("click", handleClick, true); document.addEventListener("change", handleChange, true); document.addEventListener("submit", handleSubmit, true); document.addEventListener("mousedown", (event) => { if (event.target.closest(".cwl-modal, .cwl-native-actions, #code-whats-local-root")) event.stopPropagation(); }, true); document.addEventListener("keydown", (event) => { if (event.target.closest(".cwl-modal")) event.stopPropagation(); }, true); chrome.runtime.onMessage.addListener((message) => { if (message && message.type === "CWL_OPEN_CLIENT") { const client = state.clients.find((item) => item.id === message.clientId); if (client) openChatNatively(client); } }); }
  function bootObserver() { const observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(() => scanWhatsApp(false), 1000); }); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); setInterval(() => scanWhatsApp(false), 6000); }
  async function boot() { state = await storage.getState(); drawerOpen = state.drawerOpen !== false; activeView = navItems.some((item) => item.id === state.activeView) && state.activeView !== "crm" ? state.activeView : "clients"; activeChat = getActiveChatContext(); detectedChats = getDetectedChats(); bindEvents(); bootObserver(); injectHeaderActions(); render(); scheduleDetectedPersist(); }
  boot();
})();


