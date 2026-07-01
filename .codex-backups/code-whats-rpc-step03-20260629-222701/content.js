(function () {
  if (window.__codeWhatsModuleLoaded) return;
  window.__codeWhatsModuleLoaded = true;

  const api = window.CodeWhatsStorage;
  const navItems = [
    { id: "crm", icon: "P", label: "Pipeline" },
    { id: "clients", icon: "C", label: "Clientes" },
    { id: "leads", icon: "L", label: "Leads" },
    { id: "sync", icon: "S", label: "Sincronização" }
  ];

  let state = null;
  let drawerOpen = true;
  let activeView = "clients";
  let modal = null;
  let activeChat = null;
  let detectedChats = [];
  let scanTimer = null;
  let persistTimer = null;
  let feedback = "";

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const phoneOnly = (value) => clean(value).replace(/\D/g, "");
  const isAuthed = () => Boolean(state && state.authenticated);

  function getConversationHeader() { return qs('header[data-testid="conversation-header"]') || (qs("main") && qs("main").querySelector("header")); }

  function getVisibleMessages() {
    const main = qs("main") || document.body;
    return qsa('div[data-pre-plain-text], div.message-in, div.message-out, div[role="row"]', main)
      .map((node) => ({ text: clean(node.textContent).slice(0, 500), meta: clean(node.getAttribute("data-pre-plain-text")), capturedAt: new Date().toISOString() }))
      .filter((item) => item.text)
      .slice(-2);
  }

  function getActiveChatContext() {
    const header = getConversationHeader();
    if (!header) return { hasConversation: false };
    const nameNode = qs("#chatName", header) || qs('[data-testid="conversation-info-header-chat-title"]', header) || qs('span[title]', header) || qs('span[dir="auto"]', header);
    const name = clean(nameNode && (nameNode.getAttribute("title") || nameNode.textContent));
    const photoNode = qs("img", header);
    const photo = photoNode ? clean(photoNode.src) : "";
    const phoneMatch = clean(header.textContent).match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = phoneOnly(phoneMatch && phoneMatch[0]);
    const messages = getVisibleMessages();
    const last = messages[messages.length - 1] || {};
    const waKey = phone || [name, photo ? photo.slice(-32) : "no-photo", last.meta || messages.length].filter(Boolean).join("|");
    return { hasConversation: Boolean(name), key: waKey, waKey, name, nome: name, phone, telefone: phone, photo, foto: photo, lastMessage: last.text || "", ultimaMensagem: last.text || "", lastMessageTime: last.meta || "", ultimoContato: last.meta || "", messages, visibleMessageCount: messages.length, capturedAt: new Date().toISOString() };
  }

  function parseChatListItem(row, index) {
    const raw = clean(row.textContent).replace(/wds-ic-[\w-]+|ic-push-pin|archive-refreshed|status-dblcheck|message-dblcheck/gi, "");
    if (!raw || /^(Arquivadas|Archived)\b/i.test(raw)) return null;
    const titleNode = qs('span[title]', row) || qs('[data-testid="cell-frame-title"] span', row) || qs('span[dir="auto"]', row);
    const name = clean(titleNode && (titleNode.getAttribute("title") || titleNode.textContent));
    if (!name || /^(status|comunidades|canais|nova conversa)$/i.test(name)) return null;
    const timeMatch = raw.match(/\b\d{1,2}:\d{2}\b|\bhoje\b|\bontem\b/i);
    const lastMessageTime = timeMatch ? timeMatch[0] : "";
    const lastMessage = clean(raw.replace(name, "").replace(lastMessageTime, "")).slice(-180);
    const key = [name, lastMessageTime || index].join("|");
    return { key, waKey: key, name, nome: name, telefone: "", phone: "", ultimaMensagem: lastMessage, lastMessage, ultimoContato: lastMessageTime, lastMessageTime, messages: lastMessage ? [{ text: lastMessage, meta: lastMessageTime, capturedAt: new Date().toISOString() }] : [], capturedAt: new Date().toISOString() };
  }

  function getDetectedChats() {
    const seen = new Set();
    const chats = [];
    qsa('div[role="row"], [data-testid="cell-frame-container"]').forEach((row, index) => {
      const chat = parseChatListItem(row, index);
      if (!chat || seen.has(chat.name.toLowerCase())) return;
      seen.add(chat.name.toLowerCase());
      chats.push(chat);
    });
    return chats.slice(0, 80);
  }

  function scanWhatsApp() {
    activeChat = getActiveChatContext();
    detectedChats = getDetectedChats();
    injectHeaderActions();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => { state = await api.saveDetectedChats(detectedChats); }, 900);
    render();
  }

  function injectHeaderActions() {
    const header = getConversationHeader();
    if (!isAuthed() || !header || !activeChat || !activeChat.hasConversation) { qsa(".cwl-native-actions").forEach((node) => node.remove()); return; }
    let actions = qs(".cwl-native-actions", header);
    if (!actions) { actions = document.createElement("div"); actions.className = "cwl-native-actions"; header.appendChild(actions); }
    actions.innerHTML = `<span>CODE</span><button data-action="open-add-current">Adicionar ao funil</button><button data-action="show-current-profile">Perfil</button>`;
  }

  function getRoot() { let root = qs("#code-whats-local-root"); if (!root) { root = document.createElement("div"); root.id = "code-whats-local-root"; document.body.appendChild(root); } return root; }
  function shiftWhatsApp() { const app = qs("#app") || document.body; const width = drawerOpen ? "360px" : "72px"; app.style.setProperty("--cwl-drawer-width", width); app.classList.add("cwl-whatsapp-shifted"); }
  function showFeedback(message) { feedback = message; render(); setTimeout(() => { feedback = ""; render(); }, 2400); }

  function render() {
    if (!state) return;
    shiftWhatsApp();
    getRoot().innerHTML = `<aside class="cwl-shell ${drawerOpen ? "is-open" : "is-closed"}">${renderSidebar()}${drawerOpen ? renderPanel() : ""}</aside>${feedback ? `<div class="cwl-toast">${esc(feedback)}</div>` : ""}${renderModal()}`;
  }
  function renderSidebar() { return `<nav class="cwl-sidebar"><button class="cwl-brand" data-action="toggle-drawer"><span>CW</span>${drawerOpen ? "<strong>CODE Whats</strong>" : ""}</button><div class="cwl-nav-list">${navItems.map((item) => `<button class="cwl-nav-item ${activeView === item.id ? "is-active" : ""}" data-action="set-view" data-view="${item.id}"><span>${item.icon}</span>${drawerOpen ? `<strong>${item.label}</strong>` : ""}</button>`).join("")}</div></nav>`; }
  function renderPanel() { return `<section class="cwl-panel"><header class="cwl-topbar"><div><p class="cwl-kicker">CODE Imob</p><h1>${isAuthed() ? esc((navItems.find((item) => item.id === activeView) || navItems[1]).label) : "Login"}</h1></div><button class="cwl-icon-btn" data-action="toggle-drawer">‹</button></header>${isAuthed() ? renderUnlockedPanel() : renderLoginGate()}</section>`; }
  function renderLoginGate() { return `<section class="cwl-card-panel cwl-login-screen"><h2>Acesso CODE Imob</h2><p>Faça login para liberar Pipeline, Clientes, Leads e Sincronização.</p><form data-role="login-form" class="cwl-login-form">${input("E-mail", "email", "", "email", true)}${input("Senha", "password", "", "password", true)}<button class="cwl-btn cwl-btn-primary" type="submit">Entrar</button></form>${state.lastError ? `<p class="cwl-error">${esc(state.lastError)}</p>` : `<p class="cwl-empty">Autenticação oficial via Supabase Auth será conectada na próxima etapa.</p>`}</section>`; }
  function renderUnlockedPanel() { return `<section class="cwl-current-chat"><span>Contato ativo</span><strong>${esc(activeChat && activeChat.hasConversation ? activeChat.name : "Nenhuma conversa aberta")}</strong><small>${esc(activeChat && activeChat.hasConversation ? `${activeChat.visibleMessageCount || 0} mensagens visíveis capturadas` : "Abra um chat para usar as ações do header.")}</small></section>${renderView()}`; }
  function renderView() { if (activeView === "crm") return `<section class="cwl-card-panel"><h2>Pipeline</h2><p>O pipeline é renderizado a partir do CODE Imob.</p><button class="cwl-btn cwl-btn-primary" data-action="open-crm-window">Abrir Pipeline</button></section>`; if (activeView === "leads") return renderLeads(); if (activeView === "sync") return renderSync(); return renderClients(); }
  function renderClients() { return `<section class="cwl-client-list"><h2>Clientes CODE Imob</h2>${state.clients.map((client) => `<article class="cwl-row"><button data-action="show-client-profile" data-client-id="${esc(client.id)}"><strong>${esc(client.name || client.nome)}</strong><span>${esc(client.phone || client.telefone)}</span></button><button data-action="open-client-chat" data-client-id="${esc(client.id)}">WhatsApp</button></article>`).join("") || `<p class="cwl-empty">Nenhum cliente recebido do CODE Imob.</p>`}<h2>Conversas visíveis</h2>${detectedChats.slice(0, 20).map((chat) => `<article class="cwl-row"><button data-action="open-add-detected" data-detected-key="${esc(chat.key)}"><strong>${esc(chat.name)}</strong><span>${esc(chat.lastMessage || "Conversa detectada")}</span></button></article>`).join("") || `<p class="cwl-empty">Nenhuma conversa visível detectada.</p>`}</section>`; }
  function renderLeads() { return `<section class="cwl-client-list"><h2>Leads CODE Imob</h2>${state.leads.map((lead) => `<article class="cwl-row"><button data-action="show-lead" data-lead-id="${esc(lead.id)}"><strong>${esc(lead.name || lead.nome)}</strong><span>${esc([lead.phone || lead.telefone, lead.origem, lead.createdAt].filter(Boolean).join(" · "))}</span></button><button data-action="lead-whatsapp" data-lead-id="${esc(lead.id)}">WhatsApp</button></article>`).join("") || `<p class="cwl-empty">Nenhum lead recebido do CODE Imob.</p>`}</section>`; }
  function renderSync() { return `<section class="cwl-card-panel"><h2>Sincronização</h2><p>Status: <strong>${esc(state.syncStatus)}</strong></p><p>Eventos em runtime: ${(state.syncEvents || []).length}</p><p class="cwl-empty">A sincronização será automática via Supabase Realtime e Edge Functions. Não há sincronização manual nesta arquitetura.</p><button class="cwl-btn cwl-btn-ghost" data-action="logout">Sair</button></section>`; }

  function renderModal() { if (!modal) return ""; if (modal.type === "add") return renderAddModal(); if (modal.type === "profile") return renderProfileModal(); if (modal.type === "lead") return renderLeadModal(); return ""; }
  function renderAddModal() { const chat = modal.chat || activeChat; const funnel = state.funnels.find((item) => item.id === (modal.funnelId || state.activeFunnelId)) || state.funnels[0]; return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="add-form"><header><h2>Adicionar ao funil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><p class="cwl-empty">Cliente e oportunidade serão validados no CODE Imob por telefone, sem duplicar registros.</p><div class="cwl-form-grid">${input("Nome", "nome", chat.name || chat.nome, "text", true)}${input("Telefone", "telefone", chat.phone || chat.telefone || "", "tel")}<label class="cwl-field"><span>Funil</span><select name="funnelId" data-action="modal-funnel-change">${state.funnels.map((item) => `<option value="${esc(item.id)}" ${funnel && item.id === funnel.id ? "selected" : ""}>${esc(item.name || item.nome)}</option>`).join("")}</select></label><label class="cwl-field"><span>Etapa</span><select name="stageId">${(funnel ? funnel.stages || funnel.etapas : []).map((stage) => `<option value="${esc(stage.id)}">${esc(stage.name || stage.nome)}</option>`).join("")}</select></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Enviar para CODE Imob</button></footer></form></div>`; }
  function renderProfileModal() { const client = state.clients.find((item) => item.id === modal.clientId); return `<div class="cwl-modal-backdrop" data-action="close-modal"><section class="cwl-modal"><header><h2>Perfil CODE Imob</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>${client ? `<section class="cwl-captured-grid"><article><span>Nome</span><strong>${esc(client.name || client.nome)}</strong></article><article><span>Telefone</span><strong>${esc(client.phone || client.telefone || "não informado")}</strong></article></section>` : `<p class="cwl-empty">Cliente não encontrado no cache recebido do CODE Imob.</p>`}</section></div>`; }
  function renderLeadModal() { const lead = state.leads.find((item) => item.id === modal.leadId); if (!lead) return ""; return `<div class="cwl-modal-backdrop" data-action="close-modal"><section class="cwl-modal"><header><h2>${esc(lead.name || lead.nome)}</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><section class="cwl-captured-grid"><article><span>Telefone</span><strong>${esc(lead.phone || lead.telefone)}</strong></article><article><span>Origem</span><strong>${esc(lead.origem)}</strong></article><article><span>Data</span><strong>${esc(lead.createdAt)}</strong></article></section><pre class="cwl-json-box">${esc(JSON.stringify(lead.camposFormulario || {}, null, 2))}</pre><footer><button class="cwl-btn cwl-btn-ghost" data-action="lead-whatsapp" data-lead-id="${esc(lead.id)}">Abrir WhatsApp</button><button class="cwl-btn cwl-btn-primary" data-action="lead-pipeline" data-lead-id="${esc(lead.id)}">Adicionar ao Pipeline</button></footer></section></div>`; }
  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;

  function openChatByPhone(phone) { if (phone) location.assign(`https://web.whatsapp.com/send?phone=${phone}`); }
  async function saveUi() { state.drawerOpen = drawerOpen; state.activeView = activeView; state = await api.saveState(state); }

  async function handleClick(event) {
    if (event.target.closest(".cwl-modal")) event.stopPropagation();
    const target = event.target.closest("[data-action]"); if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-drawer") { drawerOpen = !drawerOpen; await saveUi(); render(); return; }
    if (action === "set-view") { if (!isAuthed()) { activeView = target.dataset.view; render(); return; } if (target.dataset.view === "crm") { chrome.runtime.sendMessage({ type: "CWL_OPEN_CRM_WINDOW" }); return; } activeView = target.dataset.view; await saveUi(); render(); return; }
    if (action === "open-crm-window") { chrome.runtime.sendMessage({ type: "CWL_OPEN_CRM_WINDOW" }); return; }
    if (action === "logout") { state = await api.logout(); render(); return; }
    if (!isAuthed()) { render(); return; }
    if (action === "open-add-current") { if (activeChat && activeChat.hasConversation) modal = { type: "add", chat: activeChat, funnelId: state.activeFunnelId }; render(); return; }
    if (action === "open-add-detected") { const chat = detectedChats.find((item) => item.key === target.dataset.detectedKey); if (chat) modal = { type: "add", chat, funnelId: state.activeFunnelId }; render(); return; }
    if (action === "show-current-profile") { modal = { type: "profile" }; render(); return; }
    if (action === "show-client-profile") { modal = { type: "profile", clientId: target.dataset.clientId }; render(); return; }
    if (action === "show-lead") { modal = { type: "lead", leadId: target.dataset.leadId }; render(); return; }
    if (action === "lead-whatsapp") { const lead = state.leads.find((item) => item.id === target.dataset.leadId); if (lead) openChatByPhone(lead.phone || lead.telefone); return; }
    if (action === "lead-pipeline") { const lead = state.leads.find((item) => item.id === target.dataset.leadId); if (lead) modal = { type: "add", chat: { name: lead.name || lead.nome, phone: lead.phone || lead.telefone, waKey: lead.id, messages: [] }, funnelId: state.activeFunnelId }; render(); return; }
    if (action === "open-client-chat") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatByPhone(client.phone || client.telefone); return; }
    if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render(); } return; }
  }

  async function handleChange(event) { if (event.target.closest(".cwl-modal")) event.stopPropagation(); if (event.target.matches('[data-action="modal-funnel-change"]')) { modal.funnelId = event.target.value; render(); } }
  async function handleSubmit(event) {
    if (event.target.matches('[data-role="login-form"]')) { event.preventDefault(); const data = new FormData(event.target); state = await api.login({ email: data.get("email"), password: data.get("password") }); drawerOpen = true; render(); return; }
    if (event.target.matches('[data-role="add-form"]')) { event.preventDefault(); event.stopPropagation(); const data = new FormData(event.target); const chat = { ...modal.chat, nome: data.get("nome"), telefone: data.get("telefone"), messages: modal.chat.messages || activeChat.messages || [] }; state = await api.addChatToPipeline({ chat, funnelId: data.get("funnelId"), stageId: data.get("stageId") }); modal = null; showFeedback(state.lastError || "Solicitação enviada ao CODE Imob"); }
  }

  function bindEvents() { document.addEventListener("click", handleClick, true); document.addEventListener("change", handleChange, true); document.addEventListener("submit", handleSubmit, true); document.addEventListener("mousedown", (event) => { if (event.target.closest(".cwl-modal, .cwl-native-actions, #code-whats-local-root")) event.stopPropagation(); }, true); document.addEventListener("keydown", (event) => { if (event.target.closest(".cwl-modal")) event.stopPropagation(); }, true); }
  function bootObserver() { const observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scanWhatsApp, 1000); }); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); setInterval(scanWhatsApp, 7000); }
  async function boot() { state = await api.getState(); drawerOpen = state.drawerOpen !== false; activeView = navItems.some((item) => item.id === state.activeView) ? state.activeView : "clients"; activeChat = getActiveChatContext(); detectedChats = getDetectedChats(); bindEvents(); bootObserver(); injectHeaderActions(); render(); }
  boot();
})();

