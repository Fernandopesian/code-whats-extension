(function () {
  if (window.__codeWhatsModuleLoaded) return;
  window.__codeWhatsModuleLoaded = true;

  const api = window.CodeWhatsStorage;
  const navItems = [
    { id: "crm", icon: "P", label: "Pipeline" },
    { id: "clients", icon: "C", label: "Clientes" },
    { id: "leads", icon: "L", label: "Leads" }
  ];

  let state = null;
  let drawerOpen = true;
  let activeView = "clients";
  let pipelineExpanded = false;
  let modal = null;
  let activeChat = null;
  let detectedChats = [];
  let scanTimer = null;
  let persistTimer = null;
  let feedback = "";
  let clientQuery = "";
  let clientFilter = "todos";
  let leadQuery = "";
  let leadFilter = "todos";
  let lastScanSignature = "";
  let draggedOpportunityId = "";

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const phoneOnly = (value) => clean(value).replace(/\D/g, "");
  const isAuthed = () => Boolean(state && state.authenticated);
  const isCodeInputActive = () => { const active = document.activeElement; return Boolean(active && getRoot().contains(active) && active.matches("input, textarea, select, [contenteditable=true]")); };

  const normalizeText = (value) => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isActiveOpportunity = (opportunity) => !["lost", "perdido", "perdida", "won", "ganho", "ganha", "closed", "fechado", "fechada"].includes(normalizeText(opportunity && opportunity.status));

  function activeFunnel() {
    return (state && state.funnels || []).find((funnel) => funnel.id === state.activeFunnelId) || (state && state.funnels && state.funnels[0]);
  }

  function stageNameById(stageId) {
    const funnels = (state && state.funnels) || [];
    for (const funnel of funnels) {
      const stage = (funnel.stages || funnel.etapas || []).find((item) => item.id === stageId || item.stageId === stageId || item.etapaId === stageId);
      if (stage) return stage.name || stage.nome || "Etapa";
    }
    return "Etapa";
  }

  function findCodeContact(chat) {
    const source = chat || {};
    const phone = getChatPhone(source) || getPhoneFromUrl();
    const name = normalizeText(source.name || source.nome);
    const clients = (state && state.clients) || [];
    const opportunities = (state && state.opportunities) || [];
    const client = phone
      ? clients.find((item) => phoneOnly(item.phone || item.telefone) === phone)
      : clients.find((item) => name && normalizeText(item.name || item.nome) === name);
    const opportunity = opportunities.find((item) => {
      if (!isActiveOpportunity(item)) return false;
      const oppPhone = phoneOnly(item.clientPhone || item.telefone || item.phone);
      if (phone && oppPhone === phone) return true;
      if (client && item.clientId && item.clientId === client.id) return true;
      return name && normalizeText(item.clientName || item.nome || item.name) === name;
    });
    const fallbackPhone = phone || phoneOnly(client && (client.phone || client.telefone)) || phoneOnly(opportunity && (opportunity.clientPhone || opportunity.telefone || opportunity.phone));
    return { phone: fallbackPhone, client, opportunity, stageName: opportunity ? stageNameById(opportunity.stageId || opportunity.etapaId) : "" };
  }

  function resolveChatPhone(chat) {
    return findCodeContact(chat).phone;
  }
  function getConversationHeader() { return qs('header[data-testid="conversation-header"]') || (qs("main") && qs("main").querySelector("header")); }

  function stripWhatsAppDomNoise(value) {
    return clean(value)
      .replace(/\[unknown\]/gi, "")
      .replace(/wds-ic-read/gi, "")
      .replace(/ic-push-pin/gi, "")
      .replace(/\b(?:wds-ic-[\w-]+|ic-[\w-]+|tail-(?:in|out)|xptt-status|status-dblcheck|message-dblcheck|archive-refreshed)\b/gi, "")
      .replace(/\d{1,2}:\d{2}(?=\s*(?:wds-|ic-|tail-|xptt-|status-|message-))/gi, "")
      .replace(/^\s*\[[^\]]*\]\s*/i, "")
      .replace(/^.{0,80}\(voc[e\u00ea]\)\s*/i, "")
      .replace(/^\(voc[e\u00ea]\)\s*/i, "")
      .replace(/\b(?:enviado|entregue|lida|visualizada)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeSenderName(value) {
    const sender = clean(value)
      .replace(/\[unknown\]/gi, "")
      .replace(/^unknown$/i, "")
      .replace(/^no$/i, "")
      .replace(/\(voc[e\u00ea]\)/i, "")
      .replace(/[?:]+$/g, "")
      .trim();
    return sender && !/^unknown$/i.test(sender) ? sender : "";
  }

  function trimSenderPrefix(value, meta = "") {
    let text = clean(value);
    const metaSender = safeSenderName((meta.match(/\]\s*([^:]+):\s*$/) || [])[1]);
    const candidates = [metaSender, activeChat && activeChat.name, activeChat && activeChat.nome]
      .filter(Boolean)
      .map((item) => clean(item).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    candidates.forEach((name) => {
      text = text.replace(new RegExp(`^${name}\\s*(?:\\(voc[e\u00ea]\\))?\\s*`, "i"), "");
    });
    return clean(text);
  }

  function textFromMessageNode(node) {
    if (!node) return "";
    const textNodes = [
      ...qsa("span.selectable-text.copyable-text", node),
      ...qsa("[data-testid='msg-text']", node),
      ...qsa("[data-testid='conversation-msg-text']", node)
    ];
    const fromStructuredNodes = textNodes.map((item) => clean(item.innerText || item.textContent)).filter(Boolean).join("\n");
    return clean(fromStructuredNodes || node.innerText || node.textContent);
  }

  function cleanMessageText(value, meta = "") {
    const withoutDomNoise = stripWhatsAppDomNoise(value);
    const withoutSender = trimSenderPrefix(withoutDomNoise, meta);
    return stripWhatsAppDomNoise(withoutSender).slice(0, 2000);
  }

  function closestMessageNode(node) {
    return node && node.closest && (node.closest("[data-pre-plain-text]") || node.closest("[data-testid*='msg-container']") || node.closest(".message-in, .message-out") || node.closest("div[role='row']"));
  }

  function messageLeafNodes(node) {
    if (!node) return [];
    const root = closestMessageNode(node) || node;
    const nested = qsa("[data-pre-plain-text]", root);
    return nested.length ? nested : [root];
  }

  function parseMessageMeta(meta) {
    const raw = clean(meta).replace(/\[unknown\]/gi, "");
    const match = raw.match(/^\[(.*?)]\s*([^:]*):\s*$/);
    if (!match) return { date: "", time: "", sender: "" };
    const parts = match[1].split(",").map(clean).filter(Boolean);
    const time = parts.find((part) => /\d{1,2}:\d{2}/.test(part)) || "";
    const date = parts.find((part) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(part)) || "";
    return { date, time, sender: safeSenderName(match[2]) };
  }

  function activeContactLabel() {
    return clean(activeChat && (activeChat.name || activeChat.nome)) || clean(activeChat && (activeChat.phone || activeChat.telefone)) || "Cliente";
  }

  function messageAuthorType(messageNode, metaInfo) {
    if (messageNode && messageNode.closest && messageNode.closest(".message-out")) return "corretor";
    if (messageNode && messageNode.closest && messageNode.closest(".message-in")) return "cliente";
    const sender = normalizeText(safeSenderName(metaInfo && metaInfo.sender));
    const contact = normalizeText(activeContactLabel());
    if (sender && contact && sender === contact) return "cliente";
    return sender ? "corretor" : "cliente";
  }

  function messageAuthorName(authorType, metaInfo) {
    const sender = safeSenderName(metaInfo && metaInfo.sender);
    if (sender) return sender;
    if (authorType === "corretor") return "Corretor";
    return activeContactLabel();
  }

  function formatHistoryMessage(authorName, time, text) {
    const safeAuthor = safeSenderName(authorName) || "Cliente";
    const header = [safeAuthor, clean(time)].filter(Boolean).join(" \u2014 ");
    return `${header}\n${text}`.trim();
  }

  function messageTypeFromNode(node) {
    const text = clean(node && (node.innerText || node.textContent));
    if (qs("audio, [data-icon*='audio'], [data-testid*='audio']", node)) return "audio";
    if (qs("img[src^='blob:'], img[src^='data:']", node)) return "imagem";
    if (qs("video", node)) return "video";
    if (/\b(localiza[c\u00e7][a\u00e3]o|location)\b/i.test(text)) return "localizacao";
    if (qs("[data-testid*='document'], [data-icon*='document']", node) || /\b(pdf|docx?|xlsx?|arquivo|documento)\b/i.test(text)) return "documento";
    return "texto";
  }

  function messageFromNode(node) {
    const messageNode = closestMessageNode(node) || node;
    const metaNode = messageNode && (messageNode.matches && messageNode.matches("[data-pre-plain-text]") ? messageNode : qs("[data-pre-plain-text]", messageNode));
    const meta = clean(metaNode && metaNode.getAttribute && metaNode.getAttribute("data-pre-plain-text")).replace(/\[unknown\]/gi, "");
    const metaInfo = parseMessageMeta(meta);
    const content = cleanMessageText(textFromMessageNode(messageNode), meta);
    const tipoAutor = messageAuthorType(messageNode, metaInfo);
    const autor = messageAuthorName(tipoAutor, metaInfo);
    const tipo = messageTypeFromNode(messageNode);
    const text = formatHistoryMessage(autor, metaInfo.time, content);
    return { text, autor, tipo_autor: tipoAutor, data: metaInfo.date, hora: metaInfo.time, tipo, conteudo: content, author: autor, authorName: autor, remetente: autor, content, date: metaInfo.date, time: metaInfo.time, type: tipo, meta, capturedAt: new Date().toISOString() };
  }

  function isMessageSelected(node) {
    return Boolean(node && (
      node.matches('[aria-selected="true"], [aria-checked="true"], [data-selected="true"]') ||
      qs('[aria-selected="true"], [aria-checked="true"], [data-selected="true"], input[type="checkbox"]:checked', node)
    ));
  }

  function selectedMessageNodes(main) {
    const explicitNodes = qsa('[aria-selected="true"], [aria-checked="true"], [data-selected="true"], input[type="checkbox"]:checked, [data-testid*="msg-container"][aria-selected="true"], .message-in[aria-selected="true"], .message-out[aria-selected="true"], div[role="row"][aria-selected="true"]', main)
      .flatMap(messageLeafNodes)
      .filter(Boolean);
    const selectedContainers = qsa('div[data-pre-plain-text], [data-testid*="msg-container"], .message-in, .message-out', main)
      .filter(isMessageSelected)
      .flatMap(messageLeafNodes)
      .filter(Boolean);
    return Array.from(new Set([...explicitNodes, ...selectedContainers]))
      .filter((node) => cleanMessageText(textFromMessageNode(node), clean(node.getAttribute && node.getAttribute("data-pre-plain-text"))))
      .sort((a, b) => a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  function getSelectedMessages() {
    const main = qs("main") || document.body;
    const uniqueNodes = selectedMessageNodes(main);
    const selectedMessages = uniqueNodes.map(messageFromNode).filter((item) => item.conteudo);
    if (selectedMessages.length) return selectedMessages;
    const selection = window.getSelection && window.getSelection();
    const selectedText = cleanMessageText(selection && selection.toString());
    if (!selectedText || !main.contains(selection.anchorNode)) return [];
    const tipoAutor = "cliente";
    const autor = activeContactLabel();
    return [{ text: formatHistoryMessage(autor, "", selectedText), autor, tipo_autor: tipoAutor, data: "", hora: "", tipo: "texto", conteudo: selectedText, author: autor, authorName: autor, remetente: autor, content: selectedText, date: "", time: "", type: "texto", meta: "selecao manual", capturedAt: new Date().toISOString() }];
  }
  function getMessagesForHistory() {
    return getSelectedMessages();
  }

  function getVisibleMessages() {
    const main = qs("main") || document.body;
    return qsa('div[data-pre-plain-text], div.message-in, div.message-out, div[role="row"]', main)
      .map(messageFromNode)
      .filter((item) => item.text);
  }
  function getPhoneFromUrl() {
    try { return phoneOnly(new URL(location.href).searchParams.get("phone") || ""); } catch (error) { return ""; }
  }

  function getChatPhone(chat) {
    if (!chat) return "";
    const direct = phoneOnly(chat.phone || chat.telefone);
    if (direct.length >= 8) return direct;
    const rawKey = clean(chat.waKey || chat.key);
    const keyPhone = rawKey.includes("@c.us") || /^\+?\d[\d\s().-]{7,}\d$/.test(rawKey) ? phoneOnly(rawKey) : "";
    if (keyPhone.length >= 8) return keyPhone;
    const byName = phoneOnly(chat.name || chat.nome);
    return byName.length >= 8 ? byName : "";
  }

  function hydrateChatPhone(chat) {
    const phone = resolveChatPhone(chat) || getPhoneFromUrl() || getChatPhone((detectedChats || []).find((item) => clean(item.name || item.nome).toLowerCase() === clean(chat && (chat.name || chat.nome)).toLowerCase()));
    return { ...chat, phone, telefone: phone };
  }

  function getActiveChatContext() {
    const header = getConversationHeader();
    if (!header) return { hasConversation: false };
    const nameNode = qs("#chatName", header) || qs('[data-testid="conversation-info-header-chat-title"]', header) || qs('span[title]', header) || qs('span[dir="auto"]', header);
    const name = clean(nameNode && (nameNode.getAttribute("title") || nameNode.textContent));
    const photoNode = qs("img", header);
    const photo = photoNode ? clean(photoNode.src) : "";
    const phoneMatch = clean(header.textContent).match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = phoneOnly(phoneMatch && phoneMatch[0]) || getPhoneFromUrl() || (phoneOnly(name).length >= 8 ? phoneOnly(name) : "");
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
    const nextActive = getActiveChatContext();
    const nextDetected = getDetectedChats();
    const signature = JSON.stringify({
      active: nextActive.waKey,
      messages: nextActive.visibleMessageCount,
      chats: nextDetected.slice(0, 12).map((chat) => `${chat.key}:${chat.lastMessageTime}`)
    });
    if (signature === lastScanSignature) return;
    lastScanSignature = signature;
    activeChat = nextActive;
    detectedChats = nextDetected;
    injectHeaderActions();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => { state = await api.saveDetectedChats(detectedChats); }, 900);
    if (isAuthed() && !isCodeInputActive()) render();
  }

  function injectHeaderActions() {
    const header = getConversationHeader();
    if (!isAuthed() || !header || !activeChat || !activeChat.hasConversation) { qsa(".cwl-native-actions").forEach((node) => node.remove()); return; }
    let actions = qs(".cwl-native-actions", header);
    if (!actions) { actions = document.createElement("div"); actions.className = "cwl-native-actions"; header.appendChild(actions); }
    const match = findCodeContact(activeChat);
    const hasCodeContact = Boolean(match.client || match.opportunity);
    const pipelineAction = match.opportunity ? `<button type="button" disabled>Etapa: ${esc(match.stageName)}</button>` : `<button data-action="open-add-current">Adicionar ao funil</button>`;
    const historyAction = hasCodeContact ? `<button data-action="send-history-current">Enviar para hist\u00f3rico CODE</button>` : "";
    actions.innerHTML = `<span>CODE</span>${pipelineAction}${historyAction}<button data-action="show-current-profile">Perfil</button>`;
  }
  function getRoot() { let root = qs("#code-whats-local-root"); if (!root) { root = document.createElement("div"); root.id = "code-whats-local-root"; document.body.appendChild(root); } return root; }
  function shiftWhatsApp() { const app = qs("#app") || document.body; const width = drawerOpen ? "360px" : "72px"; app.style.setProperty("--cwl-drawer-width", width); getRoot().style.setProperty("--cwl-drawer-width", width); app.classList.add("cwl-whatsapp-shifted"); }
  function showFeedback(message) { feedback = message; render(); setTimeout(() => { feedback = ""; render(); }, 2400); }

  function render() {
    if (!state) return;
    shiftWhatsApp();
    getRoot().innerHTML = `<aside class="cwl-shell ${drawerOpen ? "is-open" : "is-closed"}">${renderSidebar()}${drawerOpen ? renderPanel() : ""}</aside>${renderPipelineExpanded()}${feedback ? `<div class="cwl-toast">${esc(feedback)}</div>` : ""}${renderModal()}`;
  }
  function renderSidebar() { return `<nav class="cwl-sidebar"><button class="cwl-brand" data-action="toggle-drawer"><span>CW</span>${drawerOpen ? "<strong>CODE Whats</strong>" : ""}</button><div class="cwl-nav-list">${navItems.map((item) => `<button class="cwl-nav-item ${activeView === item.id ? "is-active" : ""}" data-action="set-view" data-view="${item.id}"><span>${item.icon}</span>${drawerOpen ? `<strong>${item.label}</strong>` : ""}</button>`).join("")}</div></nav>`; }
  function renderPanel() { return `<section class="cwl-panel"><header class="cwl-topbar"><div><p class="cwl-kicker">CODE Imob</p><h1>${isAuthed() ? esc((navItems.find((item) => item.id === activeView) || navItems[1]).label) : "Login"}</h1></div><button class="cwl-icon-btn" data-action="toggle-drawer">x</button></header>${isAuthed() ? renderUnlockedPanel() : renderLoginGate()}</section>`; }
  function renderLoginGate() { return `<section class="cwl-card-panel cwl-login-screen"><h2>Acesso CODE Imob</h2><p>Fa?a login para liberar Pipeline, Clientes e Leads.</p><form data-role="login-form" class="cwl-login-form">${input("E-mail", "email", "", "email", true)}${input("Senha", "password", "", "password", true)}<button class="cwl-btn cwl-btn-primary" type="submit">Entrar</button></form>${state.lastError ? `<p class="cwl-error">${esc(state.lastError)}</p>` : `<p class="cwl-empty">Autentica??o oficial via Supabase Auth conectada.</p>`}</section>`; }
  function renderUnlockedPanel() { const current = activeChat && activeChat.hasConversation ? hydrateChatPhone(activeChat) : activeChat; return `<section class="cwl-current-chat"><span>Contato ativo</span><strong>${esc(current && current.hasConversation ? current.name : "Nenhuma conversa aberta")}</strong><small>${esc(current && current.hasConversation ? `${current.visibleMessageCount || 0} mensagens vis?veis capturadas${current.phone ? ` - ${current.phone}` : ""}` : "Abra um chat para usar as a??es do header.")}</small></section>${renderView()}`; }
  function renderView() { if (activeView === "crm") return `<section class="cwl-card-panel"><h2>Pipeline</h2><p>O pipeline ? renderizado dentro do WhatsApp Web.</p><button class="cwl-btn cwl-btn-primary cwl-full-btn" data-action="expand-pipeline">Expandir Pipeline</button></section>`; if (activeView === "leads") return renderLeads(); return renderClients(); }
  function renderClients() {
    const q = clientQuery.toLowerCase();
    const clients = state.clients.filter((client) => {
      const haystack = [client.name, client.nome, client.phone, client.telefone].join(" ").toLowerCase();
      const matchesQuery = !q || haystack.includes(q);
      const origin = clean(client.origem || client.source).toLowerCase();
      const matchesFilter = clientFilter === "todos" || origin.includes("whatsapp") || Boolean(client.waKey || client.wa_key);
      return matchesQuery && matchesFilter;
    });
    return `<section class="cwl-client-list"><h2>Clientes CODE Imob</h2><label class="cwl-field"><span>Buscar</span><input data-action="client-search" value="${esc(clientQuery)}" placeholder="Nome ou telefone"></label><div class="cwl-inline-actions"><button class="cwl-btn ${clientFilter === "todos" ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="client-filter" data-filter="todos">Todos</button><button class="cwl-btn ${clientFilter === "whatsapp" ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="client-filter" data-filter="whatsapp">WhatsApp</button></div>${clients.slice(0, 60).map((client) => `<article class="cwl-row"><button data-action="show-client-profile" data-client-id="${esc(client.id)}"><strong>${esc(client.name || client.nome || "Cliente")}</strong><span>${esc(client.phone || client.telefone || "sem telefone")}</span></button><button data-action="open-client-chat" data-client-id="${esc(client.id)}">WhatsApp</button></article>`).join("") || `<p class="cwl-empty">Nenhum cliente recebido do CODE Imob.</p>`}${clients.length > 60 ? `<p class="cwl-empty">Mostrando 60 de ${clients.length}. Use a busca para refinar.</p>` : ""}<h2>Conversas vis?veis</h2>${detectedChats.slice(0, 20).map((chat) => `<article class="cwl-row"><button data-action="open-add-detected" data-detected-key="${esc(chat.key)}"><strong>${esc(chat.name)}</strong><span>${esc(chat.lastMessage || "Conversa detectada")}</span></button></article>`).join("") || `<p class="cwl-empty">Nenhuma conversa vis?vel detectada.</p>`}</section>`;
  }
  function renderLeads() {
    const q = leadQuery.toLowerCase();
    const origins = Array.from(new Set(state.leads.map((lead) => clean(lead.origem || lead.campanha || lead.campaign || lead.source)).filter(Boolean))).slice(0, 8);
    const leads = state.leads.filter((lead) => {
      const origin = clean(lead.origem || lead.campanha || lead.campaign || lead.source);
      const haystack = [lead.name, lead.nome, lead.phone, lead.telefone, origin, lead.createdAt].join(" ").toLowerCase();
      return (!q || haystack.includes(q)) && (leadFilter === "todos" || origin === leadFilter);
    });
    return `<section class="cwl-client-list"><h2>Leads CODE Imob</h2><label class="cwl-field"><span>Buscar</span><input data-action="lead-search" value="${esc(leadQuery)}" placeholder="Nome, telefone ou origem"></label><div class="cwl-inline-actions"><button class="cwl-btn ${leadFilter === "todos" ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="lead-filter" data-filter="todos">Todos</button>${origins.map((origin) => `<button class="cwl-btn ${leadFilter === origin ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="lead-filter" data-filter="${esc(origin)}">${esc(origin)}</button>`).join("")}</div>${leads.slice(0, 60).map((lead) => `<article class="cwl-row"><button data-action="show-lead" data-lead-id="${esc(lead.id)}"><strong>${esc(lead.name || lead.nome || "Lead")}</strong><span>${esc([lead.phone || lead.telefone, lead.origem || lead.campanha || lead.campaign, lead.createdAt].filter(Boolean).join(" - "))}</span></button><button data-action="lead-whatsapp" data-lead-id="${esc(lead.id)}">WhatsApp</button></article>`).join("") || `<p class="cwl-empty">Nenhum lead recebido do CODE Imob.</p>`}${leads.length > 60 ? `<p class="cwl-empty">Mostrando 60 de ${leads.length}. Use a busca para refinar.</p>` : ""}</section>`;
  }
  function opportunitiesForStage(stageId) {
    return (state.opportunities || []).filter((item) => (item.stageId || item.etapaId) === stageId);
  }

  function clientForOpportunity(opportunity) {
    return (state.clients || []).find((client) => client.id && client.id === opportunity.clientId) || {};
  }

  function opportunityMoveId(opportunity) {
    return clean(opportunity && (opportunity.opportunityId || opportunity.oportunidade_id || opportunity.opportunity_id || opportunity.pipeline_lead_id || opportunity.pipelineLeadId || opportunity.id));
  }

  function findOpportunityByAnyId(id) {
    const wanted = clean(id);
    return (state.opportunities || []).find((item) => [item.id, item.opportunityId, item.oportunidade_id, item.opportunity_id, item.pipeline_lead_id, item.pipelineLeadId].some((value) => clean(value) === wanted));
  }

  function missingContextFields(source, fields) {
    return fields.filter((field) => {
      const value = firstValue(source, field.keys, "");
      return value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length);
    }).map((field) => field.label);
  }
  function firstValue(source, keys, fallback = "") {
    for (const key of keys) {
      const value = source && source[key];
      if (value !== undefined && value !== null && clean(value) !== "") return value;
    }
    return fallback;
  }

  function renderPipelineExpanded() {
    if (!pipelineExpanded || !isAuthed()) return "";
    const funnel = activeFunnel();
    return `<section class="cwl-pipeline-expanded"><header class="cwl-expanded-header"><div><p class="cwl-kicker">CODE Imob</p><h1>Pipeline</h1></div><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-ghost" data-action="refresh-context">Atualizar</button><button class="cwl-btn cwl-btn-primary" data-action="collapse-pipeline">Recolher Pipeline</button></div></header>${funnel ? renderPipelineBoard(funnel) : `<section class="cwl-card-panel"><p class="cwl-empty">Nenhum pipeline recebido do CODE Imob.</p></section>`}</section>`;
  }

  function renderPipelineBoard(funnel) {
    const stages = funnel.stages || funnel.etapas || [];
    return `<section class="cwl-expanded-board">${stages.map(renderPipelineStage).join("")}</section>`;
  }

  function renderPipelineStage(stage) {
    const items = opportunitiesForStage(stage.id);
    return `<article class="cwl-expanded-column" data-stage-id="${esc(stage.id)}"><header><h2>${esc(stage.name || stage.nome || "Etapa")}</h2><span>${items.length}</span></header><div class="cwl-expanded-dropzone" data-stage-id="${esc(stage.id)}">${items.map(renderPipelineCard).join("") || `<p class="cwl-empty">Sem oportunidades.</p>`}</div></article>`;
  }

  function renderPipelineCard(opportunity) {
    const client = clientForOpportunity(opportunity);
    const name = client.name || client.nome || opportunity.clientName || opportunity.nome || opportunity.name || "Cliente";
    const phone = client.phone || client.telefone || opportunity.clientPhone || opportunity.telefone || opportunity.phone || "sem telefone";
    const origin = firstValue(opportunity, ["origem", "source", "origin"], firstValue(client, ["origem", "source"], "CODE Imob"));
    const value = firstValue(opportunity, ["value", "valor", "amount"], "");
    const moveId = opportunityMoveId(opportunity);
    return `<article class="cwl-card cwl-pipeline-card" draggable="true" data-action="open-opportunity-card" data-opportunity-id="${esc(moveId)}"><div class="cwl-card-top"><div><strong>${esc(name)}</strong><span>${esc(phone)}</span></div><em class="cwl-temp cwl-temp-morno">${esc(opportunity.status || "active")}</em></div><div class="cwl-card-meta"><span>${esc(origin)}</span><span>${esc(value ? `R$ ${value}` : stageNameById(opportunity.stageId || opportunity.etapaId))}</span></div><div class="cwl-card-actions"><button data-action="open-whatsapp-opportunity" data-opportunity-id="${esc(moveId)}">WhatsApp</button></div></article>`;
  }

  function renderTextBlock(title, value) {
    if (!value) return `<article><span>${esc(title)}</span><strong>-</strong></article>`;
    const rendered = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    return `<article><span>${esc(title)}</span><strong>${esc(rendered)}</strong></article>`;
  }

  function renderOpportunityModal() {
    const opportunity = findOpportunityByAnyId(modal.opportunityId);
    if (!opportunity) return "";
    const client = clientForOpportunity(opportunity);
    const name = client.name || client.nome || opportunity.clientName || opportunity.nome || opportunity.name || "Cliente";
    const phone = client.phone || client.telefone || opportunity.clientPhone || opportunity.telefone || opportunity.phone || "";
    const origin = firstValue(opportunity, ["origem", "source", "origin"], firstValue(client, ["origem", "source"], ""));
    const type = firstValue(opportunity, ["tipo", "tipoCliente", "tipo_cliente", "clientType"], "");
    const value = firstValue(opportunity, ["value", "valor", "amount"], "");
    const history = firstValue(opportunity, ["hist\u00f3rico", "history", "timeline"], "");
    const interactions = firstValue(opportunity, ["intera\u00e7\u00f5es", "interactions", "messages"], "");
    const searchProfile = firstValue(opportunity, ["perfilBusca", "perfil_de_busca", "searchProfile", "profile"], "");
    const nextSteps = firstValue(opportunity, ["proximosPassos", "proximos_passos", "nextSteps", "next_steps"], "");
    const canSendHistory = Boolean(phoneOnly(phone));
    const missingFields = missingContextFields(opportunity, [
      { label: "hist\u00f3rico/intera\u00e7\u00f5es", keys: ["hist\u00f3rico", "history", "timeline", "intera\u00e7\u00f5es", "interactions", "messages"] },
      { label: "perfil de busca", keys: ["perfilBusca", "perfil_de_busca", "searchProfile", "profile"] },
      { label: "proximos passos", keys: ["proximosPassos", "proximos_passos", "nextSteps", "next_steps"] }
    ]);
    const missingNotice = missingFields.length ? `<p class="cwl-empty">Campos ausentes no JSON da RPC: ${esc(missingFields.join(", "))}.</p>` : "";
    return `<div class="cwl-modal-backdrop" data-action="close-modal"><section class="cwl-modal cwl-opportunity-modal"><header><div><p class="cwl-kicker">Oportunidade</p><h2>${esc(name)}</h2></div><button type="button" class="cwl-icon-btn" data-action="close-modal">x</button></header><section class="cwl-captured-grid">${renderTextBlock("Telefone", phone)}${renderTextBlock("Etapa", stageNameById(opportunity.stageId || opportunity.etapaId))}${renderTextBlock("Origem", origin)}${renderTextBlock("Tipo", type)}${renderTextBlock("Valor", value)}${renderTextBlock("Status", opportunity.status || "active")}</section><h3>Hist\u00f3rico</h3><pre class="cwl-json-box">${esc(typeof history === "object" ? JSON.stringify(history, null, 2) : history || "Sem hist\u00f3rico retornado pelo CODE Imob.")}</pre><h3>Intera\u00e7\u00f5es</h3><pre class="cwl-json-box">${esc(typeof interactions === "object" ? JSON.stringify(interactions, null, 2) : interactions || "Sem intera\u00e7\u00f5es retornadas pelo CODE Imob.")}</pre><section class="cwl-captured-grid">${renderTextBlock("Perfil de busca", searchProfile)}${renderTextBlock("Pr\u00f3ximos passos", nextSteps)}</section>${missingNotice}<footer><button class="cwl-btn cwl-btn-ghost" data-action="open-whatsapp-opportunity" data-opportunity-id="${esc(opportunityMoveId(opportunity))}">Abrir WhatsApp</button>${canSendHistory ? `<button class="cwl-btn cwl-btn-primary" data-action="send-history-current">Enviar hist\u00f3rico</button>` : ""}</footer></section></div>`;
  }
  function renderDiagnostic() {
    const diagnostic = state.contextDiagnostic;
    const counts = diagnostic && diagnostic.counts ? diagnostic.counts : { pipelines: 0, etapas: 0, oportunidades: 0, clientes: 0, leads: 0 };
    const normalized = diagnostic && diagnostic.normalizedCounts ? diagnostic.normalizedCounts : null;
    const jsonText = diagnostic ? (diagnostic.rawText || JSON.stringify(diagnostic.rawJson, null, 2)) : "Clique em Atualizar Dados para executar code_whats_get_context().";
    const normalizedText = normalized ? `Normalizado pela extens?o: pipelines ${normalized.pipelines}, etapas ${normalized.etapas}, oportunidades ${normalized.oportunidades}, clientes ${normalized.clientes}, leads ${normalized.leads}` : "";
    return `<h2>Diagn?stico code_whats_get_context</h2><div class="cwl-captured-grid"><article><span>Status HTTP</span><strong>${esc(diagnostic ? diagnostic.status : "-")}</strong></article><article><span>Pipelines</span><strong>${counts.pipelines}</strong></article><article><span>Etapas</span><strong>${counts.etapas}</strong></article><article><span>Oportunidades</span><strong>${counts.oportunidades}</strong></article><article><span>Clientes</span><strong>${counts.clientes}</strong></article><article><span>Leads</span><strong>${counts.leads}</strong></article></div>${normalizedText ? `<p class="cwl-empty">${esc(normalizedText)}</p>` : ""}${diagnostic && diagnostic.error ? `<p class="cwl-error">${esc(diagnostic.error)}</p>` : ""}<pre class="cwl-json-box" data-role="diagnostic-json">${esc(jsonText)}</pre><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-ghost" data-action="copy-diagnostic-json">Copiar JSON</button></div>`;
  }
  function renderSync() { return `<section class="cwl-card-panel cwl-sync-panel"><h2>Sincroniza??o</h2><p>Status: <strong>${esc(state.syncStatus)}</strong></p><p>Eventos em runtime: ${(state.syncEvents || []).length}</p><p class="cwl-empty">O hist\u00f3rico ? enviado manualmente pelo bot?o da conversa. N?o h? sincroniza??o cont?nua nesta vers?o.</p><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-primary" data-action="refresh-context">Atualizar Dados</button><button class="cwl-btn cwl-btn-ghost" data-action="logout">Sair</button></div>${renderDiagnostic()}</section>`; }
  function renderModal() { if (!modal) return ""; if (modal.type === "add") return renderAddModal(); if (modal.type === "profile") return renderProfileModal(); if (modal.type === "lead") return renderLeadModal(); if (modal.type === "opportunity") return renderOpportunityModal(); return ""; }
  function renderAddModal() {
    const chat = hydrateChatPhone(modal.chat || activeChat || {});
    const funnel = state.funnels.find((item) => item.id === (modal.funnelId || state.activeFunnelId)) || state.funnels[0];
    const stages = funnel ? (funnel.stages || funnel.etapas || []) : [];
    const selectedStageId = modal.stageId || (stages[0] && stages[0].id) || "";
    return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="add-form"><header><h2>Adicionar ao funil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">x</button></header><p class="cwl-empty">Pipeline CODE Imob selecionado automaticamente.</p><div class="cwl-form-grid">${input("Nome", "nome", chat.name || chat.nome, "text", true)}${input("Telefone", "telefone", chat.phone || chat.telefone || "", "tel", true)}<input type="hidden" name="funnelId" value="${esc(funnel && funnel.id)}"><label class="cwl-field"><span>Etapa</span><select name="stageId">${stages.map((stage) => `<option value="${esc(stage.id)}" ${stage.id === selectedStageId ? "selected" : ""}>${esc(stage.name || stage.nome)}</option>`).join("")}</select></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Enviar para CODE Imob</button></footer></form></div>`;
  }
  function renderProfileModal() { const client = state.clients.find((item) => item.id === modal.clientId); return `<div class="cwl-modal-backdrop" data-action="close-modal"><section class="cwl-modal"><header><h2>Perfil CODE Imob</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">x</button></header>${client ? `<section class="cwl-captured-grid"><article><span>Nome</span><strong>${esc(client.name || client.nome)}</strong></article><article><span>Telefone</span><strong>${esc(client.phone || client.telefone || "n?o informado")}</strong></article></section>` : `<p class="cwl-empty">Cliente n?o encontrado no cache recebido do CODE Imob.</p>`}</section></div>`; }
  function renderLeadModal() { const lead = state.leads.find((item) => item.id === modal.leadId); if (!lead) return ""; return `<div class="cwl-modal-backdrop" data-action="close-modal"><section class="cwl-modal"><header><h2>${esc(lead.name || lead.nome)}</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">x</button></header><section class="cwl-captured-grid"><article><span>Telefone</span><strong>${esc(lead.phone || lead.telefone)}</strong></article><article><span>Origem</span><strong>${esc(lead.origem)}</strong></article><article><span>Data</span><strong>${esc(lead.createdAt)}</strong></article></section><pre class="cwl-json-box">${esc(JSON.stringify(lead.camposFormulario || {}, null, 2))}</pre><footer><button class="cwl-btn cwl-btn-ghost" data-action="lead-whatsapp" data-lead-id="${esc(lead.id)}">Abrir WhatsApp</button><button class="cwl-btn cwl-btn-primary" data-action="lead-pipeline" data-lead-id="${esc(lead.id)}">Adicionar ao Pipeline</button></footer></section></div>`; }  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;

  function openVisibleChat(name, phone) {
    const terms = [phoneOnly(phone), name].map((item) => clean(item).toLowerCase()).filter(Boolean);
    if (!terms.length) return false;
    const rows = qsa('#side div[role="row"], #side [data-testid="cell-frame-container"], div[role="row"], [data-testid="cell-frame-container"]');
    const match = rows.find((row) => terms.some((term) => clean(row.textContent).toLowerCase().includes(term)));
    if (match) { match.click(); return true; }
    return false;
  }

  function inputNativeText(element, value) {
    element.focus();
    if (element.isContentEditable) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, value);
    } else {
      element.value = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  }

  function searchVisibleChat(name, phone) {
    const term = clean(name || phone);
    if (!term) return false;
    const search = qs('#side [contenteditable="true"][role="textbox"]') || qs('[data-testid="chat-list-search"] [contenteditable="true"]') || qsa('[contenteditable="true"][role="textbox"]').find((item) => !item.closest("footer"));
    if (!search) return false;
    inputNativeText(search, term);
    setTimeout(() => { if (!openVisibleChat(name, phone) && phone) location.assign(`https://web.whatsapp.com/send?phone=${phoneOnly(phone)}`); }, 900);
    return true;
  }

  function openChatByPhone(phone, name = "") {
    const normalizedPhone = phoneOnly(phone);
    if (openVisibleChat(name, normalizedPhone)) return;
    if (searchVisibleChat(name, normalizedPhone)) return;
    if (normalizedPhone) location.assign(`https://web.whatsapp.com/send?phone=${normalizedPhone}`);
  }

  async function saveUi() {
    state.drawerOpen = drawerOpen;
    state.activeView = activeView;
    state = await api.saveState(state);
  }

  async function handleClick(event) {
    if (event.target.closest(".cwl-modal")) event.stopPropagation();
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "toggle-drawer") { drawerOpen = !drawerOpen; await saveUi(); render(); return; }
    if (action === "set-view") {
      if (!navItems.some((item) => item.id === target.dataset.view)) return;
      activeView = target.dataset.view;
      pipelineExpanded = isAuthed() && activeView === "crm";
      await saveUi();
      render();
      return;
    }
    if (action === "expand-pipeline") { activeView = "crm"; pipelineExpanded = true; await saveUi(); render(); return; }
    if (action === "collapse-pipeline") { pipelineExpanded = false; activeView = "clients"; await saveUi(); render(); return; }
    if (action === "refresh-context") { state = await api.refreshFromCodeImob(); render(); return; }
    if (action === "copy-diagnostic-json") {
      const text = state.contextDiagnostic ? (state.contextDiagnostic.rawText || JSON.stringify(state.contextDiagnostic.rawJson, null, 2)) : "";
      if (text) await navigator.clipboard.writeText(text);
      showFeedback(text ? "JSON copiado" : "Sem JSON para copiar");
      return;
    }
    if (action === "logout") { state = await api.logout(); render(); return; }
    if (action === "client-filter") { clientFilter = target.dataset.filter || "todos"; render(); return; }
    if (action === "lead-filter") { leadFilter = target.dataset.filter || "todos"; render(); return; }

    if (!isAuthed()) { render(); return; }

    if (action === "open-add-current") { if (activeChat && activeChat.hasConversation) modal = { type: "add", chat: hydrateChatPhone(activeChat), funnelId: state.activeFunnelId }; render(); return; }
    if (action === "send-history-current") {
      const chat = hydrateChatPhone(activeChat || {});
      const match = findCodeContact(chat);
      if (!match.client && !match.opportunity) { injectHeaderActions(); return; }
      const messages = getSelectedMessages();
      if (!messages.length) { showFeedback("Selecione uma ou mais mensagens para enviar ao histÃ³rico."); return; }
      state = await api.saveChatHistory({ phone: match.phone || resolveChatPhone(chat), messages });
      showFeedback(state.lastError || "HistÃ³rico enviado para CODE Imob");
      return;
    }
    if (action === "show-current-profile") { modal = { type: "profile" }; render(); return; }
    if (action === "open-opportunity-card") { if (event.target.closest("button")) return; modal = { type: "opportunity", opportunityId: target.dataset.opportunityId }; render(); return; }
    if (action === "open-whatsapp-opportunity") {
      const opportunity = findOpportunityByAnyId(target.dataset.opportunityId);
      if (opportunity) {
        const client = clientForOpportunity(opportunity);
        openChatByPhone(client.phone || client.telefone || opportunity.clientPhone || opportunity.telefone || opportunity.phone, client.name || client.nome || opportunity.clientName || opportunity.nome || opportunity.name);
      }
      return;
    }
    if (action === "open-client-chat") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatByPhone(client.phone || client.telefone, client.name || client.nome); return; }
    if (action === "lead-whatsapp") { const lead = state.leads.find((item) => item.id === target.dataset.leadId); if (lead) openChatByPhone(lead.phone || lead.telefone, lead.name || lead.nome); return; }
    if (action === "show-client-profile") { modal = { type: "profile", clientId: target.dataset.clientId }; render(); return; }
    if (action === "show-lead") { modal = { type: "lead", leadId: target.dataset.leadId }; render(); return; }
    if (action === "lead-pipeline") { const lead = state.leads.find((item) => item.id === target.dataset.leadId); if (lead) modal = { type: "add", chat: { name: lead.name || lead.nome, phone: lead.phone || lead.telefone, waKey: lead.id, messages: [] }, funnelId: state.activeFunnelId }; render(); return; }
    if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render(); } return; }
  }
  async function handleChange(event) { if (event.target.closest(".cwl-modal")) event.stopPropagation(); if (event.target.matches('[data-action="modal-funnel-change"]')) { modal.funnelId = event.target.value; render(); } if (event.target.matches('[data-action="client-search"]')) { clientQuery = event.target.value; render(); } if (event.target.matches('[data-action="lead-search"]')) { leadQuery = event.target.value; render(); } }
  async function handleSubmit(event) {
    if (event.target.matches('[data-role="login-form"]')) { event.preventDefault(); const data = new FormData(event.target); state = await api.login({ email: data.get("email"), password: data.get("password") }); drawerOpen = true; render(); return; }
    if (event.target.matches('[data-role="add-form"]')) { event.preventDefault(); event.stopPropagation(); const data = new FormData(event.target); const chat = { ...hydrateChatPhone(modal.chat || activeChat || {}), nome: data.get("nome"), telefone: data.get("telefone"), messages: (modal.chat && modal.chat.messages) || (activeChat && activeChat.messages) || [] }; state = await api.addChatToPipeline({ chat, funnelId: data.get("funnelId") || state.activeFunnelId, stageId: data.get("stageId") }); modal = null; showFeedback(state.lastError || "CODE Imob atualizado"); }
  }


  function handleDragStart(event) {
    const card = event.target.closest(".cwl-pipeline-card");
    if (!card || !card.dataset.opportunityId) return;
    draggedOpportunityId = card.dataset.opportunityId;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/cwl-opportunity", draggedOpportunityId);
  }

  function handleDragOver(event) {
    const zone = event.target.closest(".cwl-expanded-dropzone");
    if (!zone || !draggedOpportunityId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    qsa(".cwl-expanded-dropzone.is-over").forEach((item) => { if (item !== zone) item.classList.remove("is-over"); });
    zone.classList.add("is-over");
  }

  function handleDragLeave(event) {
    const zone = event.target.closest(".cwl-expanded-dropzone");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
  }

  async function handleDrop(event) {
    const zone = event.target.closest(".cwl-expanded-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const opportunityId = event.dataTransfer.getData("application/cwl-opportunity") || draggedOpportunityId;
    draggedOpportunityId = "";
    const stageId = zone.dataset.stageId;
    const opportunity = findOpportunityByAnyId(opportunityId);
    if (!opportunity || !stageId || (opportunity.stageId || opportunity.etapaId) === stageId) { render(); return; }
    const previousOpportunities = state.opportunities.map((item) => ({ ...item }));
    const moveId = opportunityMoveId(opportunity);
    state.opportunities = state.opportunities.map((item) => opportunityMoveId(item) === moveId ? { ...item, stageId, etapaId: stageId } : item);
    render();
    const nextState = await api.moveOpportunity(moveId, stageId);
    if (nextState.lastError) {
      state = { ...nextState, opportunities: previousOpportunities };
      showFeedback(nextState.lastError);
      return;
    }
    state = nextState;
    showFeedback("Pipeline atualizado");
    render();
  }

  function handleDragEnd() {
    draggedOpportunityId = "";
    qsa(".cwl-pipeline-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
    qsa(".cwl-expanded-dropzone.is-over").forEach((zone) => zone.classList.remove("is-over"));
  }
  function bindEvents() { document.addEventListener("click", handleClick, true); document.addEventListener("change", handleChange, true); document.addEventListener("input", handleChange, true); document.addEventListener("submit", handleSubmit, true); document.addEventListener("dragstart", handleDragStart, true); document.addEventListener("dragover", handleDragOver, true); document.addEventListener("dragleave", handleDragLeave, true); document.addEventListener("drop", handleDrop, true); document.addEventListener("dragend", handleDragEnd, true); document.addEventListener("mousedown", (event) => { if (event.target.closest(".cwl-modal, .cwl-native-actions, #code-whats-local-root")) event.stopPropagation(); }, true); document.addEventListener("keydown", (event) => { if (event.target.closest(".cwl-modal, #code-whats-local-root")) event.stopPropagation(); }, true); document.addEventListener("keyup", (event) => { if (event.target.closest(".cwl-modal, #code-whats-local-root")) event.stopPropagation(); }, true); chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { if (!message || message.type !== "CWL_OPEN_VISIBLE_CHAT") return false; sendResponse({ opened: openVisibleChat(message.name, message.phone) }); return false; }); }
  function bootObserver() { const observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scanWhatsApp, 1000); }); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); setInterval(scanWhatsApp, 7000); }
  async function boot() { state = await api.restoreSession(); drawerOpen = state.drawerOpen !== false; activeView = navItems.some((item) => item.id === state.activeView) ? state.activeView : "clients"; activeChat = getActiveChatContext(); detectedChats = getDetectedChats(); bindEvents(); bootObserver(); injectHeaderActions(); render(); }
  boot();
})();













