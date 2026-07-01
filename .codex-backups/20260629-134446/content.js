(function () {
  if (window.__codeWhatsLocalV2Loaded) return;
  window.__codeWhatsLocalV2Loaded = true;

  const storage = window.CodeWhatsStorage;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const tabs = [
    { id: "kanban", icon: "K", label: "Kanban" },
    { id: "clients", icon: "C", label: "Clientes" },
    { id: "profile", icon: "P", label: "Perfil" },
    { id: "notes", icon: "N", label: "Notas" },
    { id: "tools", icon: "T", label: "Ferramentas" }
  ];

  let state = null;
  let drawerOpen = true;
  let activeView = "kanban";
  let modal = null;
  let currentConversation = null;
  let observer = null;
  let scanTimer = null;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const phoneOnly = (value) => clean(value).replace(/\D/g, "");
  const escapeHtml = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const activeClients = () => state.clients.filter((client) => client.funnelId === activeFunnel().id);
  const selectedClient = () => findClientForConversation() || activeClients()[0] || state.clients[0] || null;

  const getRoot = () => {
    let root = qs("#code-whats-local-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "code-whats-local-root";
      document.body.appendChild(root);
    }
    return root;
  };

  const getAppHost = () => qs("#app") || document.body;

  const applyLayout = () => {
    const host = getAppHost();
    const width = drawerOpen ? "430px" : "64px";
    host.style.setProperty("--cwl-drawer-width", width);
    host.classList.add("cwl-whatsapp-shifted");
    document.documentElement.style.setProperty("--cwl-drawer-width", width);
  };

  const removeLayout = () => {
    const host = getAppHost();
    host.classList.remove("cwl-whatsapp-shifted");
    host.style.removeProperty("--cwl-drawer-width");
  };

  const captureConversation = () => {
    const main = qs('div[role="application"]') || qs("main") || document.body;
    const header = qs("header", main) || qs("header");
    const titleNode = header && (qs('span[title]', header) || qs("span[dir='auto']", header));
    const title = clean(titleNode && (titleNode.getAttribute("title") || titleNode.textContent));
    const headerText = clean(header && header.textContent);
    const phoneMatch = headerText.match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = phoneOnly(phoneMatch && phoneMatch[0]);
    const messages = qsa('div[data-pre-plain-text], div.message-in, div.message-out, div[role="row"]', main)
      .filter((node) => clean(node.textContent).length > 0);
    const lastNode = messages[messages.length - 1];
    const pre = lastNode && lastNode.getAttribute("data-pre-plain-text");
    const timeMatch = pre && pre.match(/\[(.*?)\]/);
    const lastMessage = clean(lastNode && lastNode.textContent).slice(0, 320);

    return {
      name: title || "Conversa aberta",
      chatTitle: title || "Conversa aberta",
      phone,
      waKey: phone || title || location.href,
      lastMessage,
      lastMessageTime: timeMatch ? timeMatch[1] : "",
      visibleMessageCount: messages.length,
      capturedAt: new Date().toISOString()
    };
  };

  const refreshConversation = () => {
    const next = captureConversation();
    const changed = !currentConversation || JSON.stringify(next) !== JSON.stringify(currentConversation);
    currentConversation = next;
    if (changed && state) render();
  };

  const findClientForConversation = () => {
    if (!currentConversation) return null;
    const key = currentConversation.waKey;
    const phone = currentConversation.phone;
    const title = currentConversation.chatTitle;
    return state.clients.find((client) =>
      (key && client.waKey === key) ||
      (phone && phoneOnly(client.phone) === phone) ||
      (title && clean(client.chatTitle || client.name).toLowerCase() === title.toLowerCase())
    );
  };

  const stats = () => {
    const clients = activeClients();
    return {
      total: clients.length,
      hot: clients.filter((client) => client.temperature === "quente").length,
      follow: clients.filter((client) => clean(client.nextAction) || client.reminders.some((reminder) => !reminder.done)).length,
      value: clients.reduce((sum, client) => sum + (Number(client.value) || 0), 0)
    };
  };

  const render = () => {
    if (!state) return;
    applyLayout();
    const root = getRoot();
    root.innerHTML = `
      <aside class="cwl-shell ${drawerOpen ? "is-open" : "is-closed"}" aria-label="CODE Whats Local">
        ${renderRail()}
        ${drawerOpen ? renderDrawer() : ""}
      </aside>
      ${renderContextBar()}
      ${renderModal()}
    `;
  };

  const renderRail = () => `
    <nav class="cwl-rail">
      <button class="cwl-brand" data-action="toggle-drawer" title="CODE Whats">CW</button>
      ${tabs.map((tab) => `
        <button class="cwl-rail-btn ${activeView === tab.id ? "is-active" : ""}" data-action="set-view" data-view="${tab.id}" title="${tab.label}">
          <span>${tab.icon}</span>
        </button>
      `).join("")}
      <button class="cwl-rail-btn" data-action="export-backup" title="Exportar backup">E</button>
      <button class="cwl-rail-btn" data-action="import-backup" title="Importar backup">I</button>
      <input class="cwl-file-input" type="file" accept="application/json" data-role="backup-file">
    </nav>
  `;

  const renderDrawer = () => {
    const totals = stats();
    return `
      <section class="cwl-drawer">
        <header class="cwl-topbar">
          <div>
            <p class="cwl-kicker">CRM local</p>
            <h1>CODE Whats</h1>
          </div>
          <button class="cwl-icon-btn" data-action="toggle-drawer" title="Recolher">‹</button>
        </header>
        <section class="cwl-capture">
          <div>
            <span>Conversa atual</span>
            <strong>${escapeHtml(currentConversation && currentConversation.name)}</strong>
            <small>${escapeHtml(conversationMeta())}</small>
          </div>
          <button class="cwl-btn cwl-btn-primary" data-action="open-add-current">Adicionar ao funil</button>
        </section>
        <section class="cwl-stats">
          ${statCard("Clientes", totals.total)}
          ${statCard("Quentes", totals.hot)}
          ${statCard("Follow-ups", totals.follow)}
          ${statCard("Valor", money.format(totals.value))}
        </section>
        ${renderView()}
      </section>
    `;
  };

  const conversationMeta = () => {
    if (!currentConversation) return "Aguardando WhatsApp Web";
    const parts = [];
    if (currentConversation.phone) parts.push(currentConversation.phone);
    if (currentConversation.visibleMessageCount) parts.push(`${currentConversation.visibleMessageCount} mensagens visiveis`);
    if (currentConversation.lastMessageTime) parts.push(currentConversation.lastMessageTime);
    return parts.join(" • ") || "Dados disponiveis no DOM";
  };

  const statCard = (label, value) => `<article class="cwl-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;

  const renderView = () => {
    if (activeView === "clients") return renderClientsView();
    if (activeView === "profile") return renderProfileView();
    if (activeView === "notes") return renderNotesView();
    if (activeView === "tools") return renderToolsView();
    return renderKanbanView();
  };

  const renderFunnelControls = () => `
    <section class="cwl-toolbar">
      <label class="cwl-field">
        <span>Funil</span>
        <select data-action="change-funnel">
          ${state.funnels.map((funnel) => `<option value="${funnel.id}" ${funnel.id === activeFunnel().id ? "selected" : ""}>${escapeHtml(funnel.name)}</option>`).join("")}
        </select>
      </label>
      <button class="cwl-btn cwl-btn-ghost" data-action="new-funnel">Novo funil</button>
      <button class="cwl-btn cwl-btn-ghost" data-action="new-column">Nova etapa</button>
    </section>
  `;

  const renderKanbanView = () => `
    ${renderFunnelControls()}
    <main class="cwl-kanban">
      ${activeFunnel().columns.map(renderColumn).join("")}
    </main>
  `;

  const renderColumn = (column) => {
    const clients = activeClients().filter((client) => client.columnId === column.id);
    return `
      <section class="cwl-column" data-column-id="${column.id}">
        <header>
          <input class="cwl-column-title" value="${escapeHtml(column.name)}" data-action="rename-column" data-column-id="${column.id}" title="Editar etapa">
          <span>${clients.length}</span>
          <button data-action="delete-column" data-column-id="${column.id}" title="Excluir etapa">×</button>
        </header>
        <div class="cwl-dropzone" data-column-id="${column.id}">
          ${clients.map(renderCard).join("") || `<p class="cwl-empty">Arraste ou adicione contatos.</p>`}
        </div>
      </section>
    `;
  };

  const renderCard = (client) => `
    <article class="cwl-card" draggable="true" data-client-id="${client.id}">
      <div class="cwl-card-top">
        <div><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml(client.phone || client.chatTitle || "WhatsApp")}</span></div>
        <em class="cwl-temp cwl-temp-${client.temperature}">${escapeHtml(client.temperature)}</em>
      </div>
      <div class="cwl-card-meta"><span>${escapeHtml(client.label || "Sem etiqueta")}</span><span>${money.format(client.value)}</span></div>
      ${client.nextAction ? `<p class="cwl-next">${escapeHtml(client.nextAction)}</p>` : ""}
      <div class="cwl-card-actions">
        <button data-action="open-profile" data-client-id="${client.id}">Perfil</button>
        <button data-action="edit-client" data-client-id="${client.id}">Editar</button>
      </div>
    </article>
  `;

  const renderClientsView = () => `
    ${renderFunnelControls()}
    <section class="cwl-list">
      ${activeClients().map((client) => `
        <article class="cwl-row" data-client-id="${client.id}">
          <button data-action="open-client-chat" data-client-id="${client.id}"><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml(client.phone || client.chatTitle)}</span></button>
          <button data-action="open-profile" data-client-id="${client.id}">Perfil</button>
        </article>
      `).join("") || `<p class="cwl-empty">Nenhum cliente neste funil.</p>`}
    </section>
  `;

  const renderProfileView = () => {
    const client = selectedClient();
    if (!client) return `<section class="cwl-panel-empty">Abra uma conversa e adicione ao funil.</section>`;
    const funnel = state.funnels.find((item) => item.id === client.funnelId);
    const column = funnel && funnel.columns.find((item) => item.id === client.columnId);
    return `
      <section class="cwl-profile">
        <header>
          <div><p class="cwl-kicker">Perfil do contato</p><h2>${escapeHtml(client.name)}</h2><span>${escapeHtml(client.phone || client.chatTitle || "Sem telefone")}</span></div>
          <button class="cwl-btn cwl-btn-primary" data-action="open-client-chat" data-client-id="${client.id}">Abrir chat</button>
        </header>
        <dl>
          <div><dt>Funil</dt><dd>${escapeHtml(funnel && funnel.name)}</dd></div>
          <div><dt>Etapa</dt><dd>${escapeHtml(column && column.name)}</dd></div>
          <div><dt>Temperatura</dt><dd>${escapeHtml(client.temperature)}</dd></div>
          <div><dt>Proxima acao</dt><dd>${escapeHtml(client.nextAction || "-")}</dd></div>
        </dl>
        <section class="cwl-profile-block"><h3>Observacoes</h3><p>${escapeHtml(client.note || "Sem observacoes.")}</p></section>
        <section class="cwl-profile-block"><h3>Historico de anotacoes</h3>${renderNotes(client)}</section>
        <section class="cwl-profile-block"><h3>Lembretes</h3>${renderReminders(client)}</section>
      </section>
    `;
  };

  const renderNotesView = () => {
    const client = selectedClient();
    return `
      <section class="cwl-notes-view">
        <header><h2>Anotacoes e lembretes</h2><span>${escapeHtml(client ? client.name : "Nenhum contato")}</span></header>
        ${client ? `
          <div class="cwl-inline-actions">
            <button class="cwl-btn cwl-btn-primary" data-action="quick-note" data-client-id="${client.id}">Adicionar anotacao</button>
            <button class="cwl-btn cwl-btn-ghost" data-action="quick-reminder" data-client-id="${client.id}">Criar lembrete</button>
          </div>
          ${renderNotes(client)}
          ${renderReminders(client)}
        ` : `<p class="cwl-empty">Selecione ou adicione um contato.</p>`}
      </section>
    `;
  };

  const renderNotes = (client) => client.notes.length
    ? `<ul class="cwl-history">${client.notes.map((note) => `<li><span>${new Date(note.createdAt).toLocaleString("pt-BR")}</span>${escapeHtml(note.text)}</li>`).join("")}</ul>`
    : `<p class="cwl-empty">Sem anotacoes ainda.</p>`;

  const renderReminders = (client) => client.reminders.length
    ? `<ul class="cwl-history">${client.reminders.map((reminder) => `<li><span>${escapeHtml(reminder.dueAt || "Sem data")}</span>${escapeHtml(reminder.text)}</li>`).join("")}</ul>`
    : `<p class="cwl-empty">Sem lembretes.</p>`;

  const renderToolsView = () => `
    <section class="cwl-tools">
      ${[
        "Mensagens agendadas",
        "Scripts rapidos",
        "Resumo IA",
        "Timeline",
        "Score comercial",
        "Google Calendar",
        "Analise de conversa"
      ].map((tool) => `<article><strong>${tool}</strong><span>Estrutura reservada para versoes futuras.</span></article>`).join("")}
    </section>
  `;

  const renderContextBar = () => `
    <section class="cwl-contextbar">
      <button data-action="open-add-current">Adicionar ao funil</button>
      <button data-action="context-reminder">Criar lembrete</button>
      <button data-action="context-note">Adicionar anotacao</button>
      <button data-action="show-current-profile">Perfil do contato</button>
      <button data-action="pin-current-chat">Fixar chat local</button>
    </section>
  `;

  const renderModal = () => {
    if (!modal) return "";
    if (modal.type === "add-current") return renderAddCurrentModal();
    if (modal.type === "client") return renderClientModal();
    return "";
  };

  const renderAddCurrentModal = () => {
    const conversation = currentConversation || captureConversation();
    const funnel = state.funnels.find((item) => item.id === (modal.funnelId || state.activeFunnelId)) || activeFunnel();
    return `
      <div class="cwl-modal-backdrop" data-action="close-modal">
        <form class="cwl-modal" data-role="add-current-form">
          <header><h2>Adicionar ao funil</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>
          <div class="cwl-form-grid">
            ${input("Nome", "name", conversation.name, "text", true)}
            ${input("Telefone", "phone", conversation.phone, "tel")}
            <label class="cwl-field"><span>Funil</span><select name="funnelId" data-action="modal-funnel-change">${state.funnels.map((item) => `<option value="${item.id}" ${item.id === funnel.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
            <label class="cwl-field"><span>Etapa</span><select name="columnId">${funnel.columns.map((column) => `<option value="${column.id}">${escapeHtml(column.name)}</option>`).join("")}</select></label>
            ${input("Novo funil", "newFunnel", "")}
            ${input("Nova etapa", "newColumn", "")}
            ${input("Etiqueta", "label", "WhatsApp")}
            <label class="cwl-field"><span>Temperatura</span><select name="temperature"><option value="frio">frio</option><option value="morno" selected>morno</option><option value="quente">quente</option></select></label>
            ${input("Valor estimado", "value", "", "number")}
            <label class="cwl-field cwl-field-wide"><span>Observacao</span><textarea name="note" rows="3">Ultima mensagem: ${escapeHtml(conversation.lastMessage)}</textarea></label>
            <label class="cwl-field cwl-field-wide"><span>Proxima acao</span><textarea name="nextAction" rows="2"></textarea></label>
          </div>
          <footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar contato</button></footer>
        </form>
      </div>
    `;
  };

  const renderClientModal = () => {
    const client = state.clients.find((item) => item.id === modal.clientId);
    if (!client) return "";
    return `
      <div class="cwl-modal-backdrop" data-action="close-modal">
        <form class="cwl-modal" data-role="client-form">
          <header><h2>Editar cliente</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header>
          <div class="cwl-form-grid">
            ${input("Nome", "name", client.name, "text", true)}
            ${input("Telefone", "phone", client.phone, "tel")}
            ${input("Etiqueta", "label", client.label)}
            <label class="cwl-field"><span>Temperatura</span><select name="temperature">${["frio", "morno", "quente"].map((temp) => `<option value="${temp}" ${client.temperature === temp ? "selected" : ""}>${temp}</option>`).join("")}</select></label>
            ${input("Valor estimado", "value", client.value, "number")}
            <label class="cwl-field cwl-field-wide"><span>Observacao</span><textarea name="note" rows="3">${escapeHtml(client.note)}</textarea></label>
            <label class="cwl-field cwl-field-wide"><span>Proxima acao</span><textarea name="nextAction" rows="2">${escapeHtml(client.nextAction)}</textarea></label>
          </div>
          <footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="delete-client" data-client-id="${client.id}">Excluir</button><button class="cwl-btn cwl-btn-primary" type="submit">Salvar</button></footer>
        </form>
      </div>
    `;
  };

  const input = (label, name, value, type = "text", required = false) => `
    <label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}></label>
  `;

  const saveUiState = async () => {
    state.drawerOpen = drawerOpen;
    state.activeView = activeView;
    state = await storage.saveState(state);
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

  const openChatNatively = (client) => {
    const terms = [client.chatTitle, client.name, client.phone].map(clean).filter(Boolean);
    const rows = qsa('div[role="row"], [aria-label*="Chat"], [data-testid="cell-frame-container"]');
    for (const row of rows) {
      const text = clean(row.textContent).toLowerCase();
      if (terms.some((term) => text.includes(term.toLowerCase()))) {
        row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        row.click();
        return true;
      }
    }
    const phone = phoneOnly(client.phone);
    if (phone) window.history.pushState(null, "", `/send?phone=${phone}`);
    if (phone) location.assign(`https://web.whatsapp.com/send?phone=${phone}`);
    return false;
  };

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
  };

  const handleClick = async (event) => {
    const target = event.target.closest("[data-action], .cwl-card");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "toggle-drawer") { drawerOpen = !drawerOpen; await saveUiState(); render(); return; }
    if (action === "set-view") { activeView = target.dataset.view; await saveUiState(); render(); return; }
    if (action === "open-add-current") { modal = { type: "add-current", funnelId: state.activeFunnelId }; render(); return; }
    if (action === "close-modal") { if (event.target === target || target.matches("button")) { modal = null; render(); } return; }
    if (action === "new-funnel") { const name = prompt("Nome do novo funil:"); if (name) state = await storage.createFunnel(name); render(); return; }
    if (action === "new-column") { const name = prompt("Nome da nova etapa:"); if (name) state = await storage.createColumn(activeFunnel().id, name); render(); return; }
    if (action === "delete-column") { if (confirm("Excluir esta etapa? Os cards serao movidos para outra etapa.")) state = await storage.deleteColumn(activeFunnel().id, target.dataset.columnId); render(); return; }
    if (action === "edit-client") { modal = { type: "client", clientId: target.dataset.clientId }; render(); return; }
    if (action === "delete-client") { if (confirm("Excluir este cliente local?")) state = await storage.deleteClient(target.dataset.clientId); modal = null; render(); return; }
    if (action === "open-profile") { activeView = "profile"; await saveUiState(); render(); return; }
    if (action === "open-client-chat") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatNatively(client); return; }
    if (action === "show-current-profile") { activeView = "profile"; drawerOpen = true; await saveUiState(); render(); return; }
    if (action === "context-note" || action === "quick-note") { await addPromptNote(target.dataset.clientId); return; }
    if (action === "context-reminder" || action === "quick-reminder") { await addPromptReminder(target.dataset.clientId); return; }
    if (action === "pin-current-chat") { await pinCurrentChat(); return; }
    if (action === "export-backup") { downloadBackup(); return; }
    if (action === "import-backup") { qs('[data-role="backup-file"]').click(); return; }
    if (target.classList.contains("cwl-card")) { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openChatNatively(client); }
  };

  const handleChange = async (event) => {
    if (event.target.matches('[data-action="change-funnel"]')) {
      state.activeFunnelId = event.target.value;
      state = await storage.saveState(state);
      render();
    }
    if (event.target.matches('[data-action="modal-funnel-change"]')) {
      modal.funnelId = event.target.value;
      render();
    }
    if (event.target.matches('[data-role="backup-file"]') && event.target.files[0]) {
      try { state = await storage.importState(JSON.parse(await event.target.files[0].text())); render(); }
      catch (error) { alert("Nao foi possivel importar o backup. Verifique se o JSON e valido."); }
    }
  };

  const handleInput = async (event) => {
    if (!event.target.matches('[data-action="rename-column"]')) return;
    clearTimeout(event.target._cwlTimer);
    const inputEl = event.target;
    inputEl._cwlTimer = setTimeout(async () => {
      state = await storage.renameColumn(activeFunnel().id, inputEl.dataset.columnId, inputEl.value);
    }, 450);
  };

  const handleSubmit = async (event) => {
    if (event.target.matches('[data-role="add-current-form"]')) { event.preventDefault(); await submitAddCurrent(event.target); }
    if (event.target.matches('[data-role="client-form"]')) { event.preventDefault(); await submitClient(event.target); }
  };

  const submitAddCurrent = async (form) => {
    const data = new FormData(form);
    let funnelId = data.get("funnelId");
    if (clean(data.get("newFunnel"))) {
      state = await storage.createFunnel(data.get("newFunnel"));
      funnelId = state.activeFunnelId;
    }
    if (clean(data.get("newColumn"))) state = await storage.createColumn(funnelId, data.get("newColumn"));
    const funnel = state.funnels.find((item) => item.id === funnelId);
    const columnId = clean(data.get("newColumn")) ? funnel.columns[funnel.columns.length - 1].id : data.get("columnId");
    state = await storage.upsertClient({
      funnelId,
      columnId,
      name: data.get("name"),
      phone: data.get("phone"),
      chatTitle: currentConversation.chatTitle,
      waKey: currentConversation.waKey,
      label: data.get("label"),
      temperature: data.get("temperature"),
      value: data.get("value"),
      note: data.get("note"),
      nextAction: data.get("nextAction"),
      captured: currentConversation
    });
    modal = null;
    activeView = "profile";
    render();
  };

  const submitClient = async (form) => {
    const data = new FormData(form);
    const existing = state.clients.find((item) => item.id === modal.clientId);
    state = await storage.upsertClient({ ...existing, name: data.get("name"), phone: data.get("phone"), label: data.get("label"), temperature: data.get("temperature"), value: data.get("value"), note: data.get("note"), nextAction: data.get("nextAction") });
    modal = null;
    render();
  };

  const ensureCurrentClient = async () => {
    const existing = findClientForConversation();
    if (existing) return existing;
    const funnel = activeFunnel();
    await storage.upsertClient({
      funnelId: funnel.id,
      columnId: funnel.columns[0].id,
      name: currentConversation.name,
      phone: currentConversation.phone,
      chatTitle: currentConversation.chatTitle,
      waKey: currentConversation.waKey,
      label: "WhatsApp",
      captured: currentConversation
    });
    state = await storage.getState();
    return findClientForConversation();
  };

  const addPromptNote = async (clientId) => {
    const client = clientId ? state.clients.find((item) => item.id === clientId) : await ensureCurrentClient();
    const text = prompt("Anotacao local:");
    if (client && text) state = await storage.addNote(client.id, text);
    render();
  };

  const addPromptReminder = async (clientId) => {
    const client = clientId ? state.clients.find((item) => item.id === clientId) : await ensureCurrentClient();
    const text = prompt("Lembrete:");
    const dueAt = text ? prompt("Data ou horario do lembrete (opcional):") : "";
    if (client && text) state = await storage.addReminder(client.id, text, dueAt || "");
    render();
  };

  const pinCurrentChat = async () => {
    const client = await ensureCurrentClient();
    if (client) state = await storage.togglePinned(client.id);
    render();
  };

  const handleDragStart = (event) => {
    const card = event.target.closest(".cwl-card");
    if (!card) return;
    event.dataTransfer.setData("text/plain", card.dataset.clientId);
    card.classList.add("is-dragging");
  };
  const handleDragEnd = (event) => { const card = event.target.closest(".cwl-card"); if (card) card.classList.remove("is-dragging"); };
  const handleDragOver = (event) => { const zone = event.target.closest(".cwl-dropzone"); if (zone) { event.preventDefault(); zone.classList.add("is-over"); } };
  const handleDragLeave = (event) => { const zone = event.target.closest(".cwl-dropzone"); if (zone) zone.classList.remove("is-over"); };
  const handleDrop = async (event) => {
    const zone = event.target.closest(".cwl-dropzone");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-over");
    const clientId = event.dataTransfer.getData("text/plain");
    if (clientId) state = await storage.moveClient(clientId, zone.dataset.columnId);
    render();
  };

  const bootObserver = () => {
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(refreshConversation, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(refreshConversation, 4000);
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

  window.addEventListener("beforeunload", removeLayout);
  boot();
})();
