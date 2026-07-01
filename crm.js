(function () {
  const api = window.CodeWhatsStorage;
  let state = null;
  let modal = null;
  let query = "";
  let clientFilter = "todos";
  let leadFilter = "todos";
  let section = "pipeline";

  const esc = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const phone = (value) => clean(value).replace(/\D/g, "");
  const isAuthed = () => Boolean(state && state.authenticated);
  const activeFunnel = () => state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
  const opportunitiesFor = (stageId) => state.opportunities.filter((item) => item.stageId === stageId || item.etapaId === stageId);
  const clientFor = (clientId) => state.clients.find((client) => client.id === clientId) || {};

  function render() {
    const app = document.querySelector('[data-role="crm-app"]');
    if (!isAuthed()) { app.innerHTML = renderLogin(); return; }
    app.innerHTML = `
      <header class="cwl-crm-header">
        <div><p class="cwl-kicker">CODE Imob</p><h1>CODE Whats</h1></div>
        <div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-ghost" data-action="section-pipeline">Pipeline</button><button class="cwl-btn cwl-btn-ghost" data-action="section-clients">Clientes</button><button class="cwl-btn cwl-btn-ghost" data-action="section-leads">Leads</button></div>
        <div class="cwl-inline-actions">${state.funnels.length > 1 ? `<label class="cwl-field"><span>Funil</span><select data-action="change-funnel">${state.funnels.map((funnel) => `<option value="${esc(funnel.id)}" ${funnel.id === state.activeFunnelId ? "selected" : ""}>${esc(funnel.name || funnel.nome)}</option>`).join("")}</select></label>` : ""}<input class="cwl-crm-search" data-action="search" placeholder="Buscar" value="${esc(query)}"></div>
      </header>
      <section class="cwl-sync-warning">Pipeline, clientes e leads são dados oficiais do CODE Imob. Esta janela apenas renderiza e envia ações para a plataforma.</section>
      ${section === "clients" ? renderClients() : section === "leads" ? renderLeads() : renderPipeline()}
      ${renderModal()}
    `;
  }

  function renderLogin() { return `<section class="cwl-crm-app"><div class="cwl-card-panel cwl-login-screen"><p class="cwl-kicker">CODE Imob</p><h1>Login obrigatório</h1><p>Autentique-se para acessar Pipeline, Clientes e Leads.</p><form data-role="login-form" class="cwl-form-grid">${input("E-mail", "email", "", "email", true)}${input("Senha", "password", "", "password", true)}<button class="cwl-btn cwl-btn-primary" type="submit">Entrar</button></form>${state && state.lastError ? `<p class="cwl-error">${esc(state.lastError)}</p>` : `<p class="cwl-empty">Configure o Supabase para autenticar usuários CODE Master.</p>`}</div></section>`; }
  function renderPipeline() {
    const funnel = activeFunnel();
    if (!funnel) return `<section class="cwl-card-panel"><p class="cwl-empty">Nenhum pipeline recebido do CODE Imob.</p></section>`;
    return `<section class="cwl-crm-board">${(funnel.stages || funnel.etapas || []).map(renderStage).join("")}</section>`;
  }
  function renderStage(stage) { const items = opportunitiesFor(stage.id); return `<article class="cwl-crm-column" data-stage-id="${esc(stage.id)}"><header><h2>${esc(stage.name || stage.nome)}</h2><span>${items.length}</span></header><div class="cwl-crm-dropzone" data-stage-id="${esc(stage.id)}">${items.map(renderOpportunity).join("") || `<p class="cwl-empty">Sem oportunidades.</p>`}</div></article>`; }
  function renderOpportunity(opportunity) { const client = clientFor(opportunity.clientId); const displayName = client.name || client.nome || opportunity.clientName || opportunity.nome || "Cliente"; const displayPhone = client.phone || client.telefone || opportunity.clientPhone || opportunity.telefone || "sem telefone"; return `<article class="cwl-card" draggable="true" data-opportunity-id="${esc(opportunity.id)}"><div class="cwl-card-top"><div><strong>${esc(displayName)}</strong><span>${esc(displayPhone)}</span></div><em class="cwl-temp cwl-temp-morno">${esc(opportunity.status || "active")}</em></div><div class="cwl-card-actions"><button data-action="open-whatsapp" data-client-id="${esc(client.id || opportunity.clientId)}" data-phone="${esc(displayPhone)}" data-name="${esc(displayName)}">Abrir WhatsApp</button></div></article>`; }

  function renderClients() {
    const q = query.toLowerCase();
    const clients = state.clients.filter((client) => {
      const haystack = [client.name, client.nome, client.phone, client.telefone].join(" ").toLowerCase();
      const origin = clean(client.origem || client.source).toLowerCase();
      return (!q || haystack.includes(q)) && (clientFilter === "todos" || origin.includes("whatsapp") || Boolean(client.waKey || client.wa_key));
    });
    return `<section class="cwl-leads-board"><article class="cwl-crm-column"><header><h2>Clientes CODE Imob</h2><span>${clients.length}</span></header><div class="cwl-inline-actions"><button class="cwl-btn ${clientFilter === "todos" ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="client-filter" data-filter="todos">Todos</button><button class="cwl-btn ${clientFilter === "whatsapp" ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="client-filter" data-filter="whatsapp">WhatsApp</button></div><div class="cwl-crm-dropzone">${clients.slice(0, 120).map((client) => `<article class="cwl-card"><div class="cwl-card-top"><div><strong>${esc(client.name || client.nome || "Cliente")}</strong><span>${esc(client.phone || client.telefone || "sem telefone")}</span></div></div><div class="cwl-card-actions"><button data-action="open-whatsapp" data-client-id="${esc(client.id)}" data-phone="${esc(client.phone || client.telefone)}" data-name="${esc(client.name || client.nome)}">Abrir WhatsApp</button></div></article>`).join("") || `<p class="cwl-empty">Nenhum cliente recebido do CODE Imob.</p>`}${clients.length > 120 ? `<p class="cwl-empty">Mostrando 120 de ${clients.length}. Use a busca para refinar.</p>` : ""}</div></article></section>`;
  }
  function renderLeads() {
    const q = query.toLowerCase();
    const origins = Array.from(new Set(state.leads.map((lead) => clean(lead.origem || lead.campanha || lead.campaign || lead.source)).filter(Boolean))).slice(0, 10);
    const leads = state.leads.filter((lead) => {
      const origin = clean(lead.origem || lead.campanha || lead.campaign || lead.source);
      const haystack = [lead.name, lead.nome, lead.phone, lead.telefone, origin].join(" ").toLowerCase();
      return (!q || haystack.includes(q)) && (leadFilter === "todos" || origin === leadFilter);
    });
    return `<section class="cwl-leads-board"><article class="cwl-crm-column"><header><h2>Leads CODE Imob</h2><span>${leads.length}</span></header><div class="cwl-inline-actions"><button class="cwl-btn ${leadFilter === "todos" ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="lead-filter" data-filter="todos">Todos</button>${origins.map((origin) => `<button class="cwl-btn ${leadFilter === origin ? "cwl-btn-primary" : "cwl-btn-ghost"}" data-action="lead-filter" data-filter="${esc(origin)}">${esc(origin)}</button>`).join("")}</div><div class="cwl-crm-dropzone">${leads.slice(0, 120).map((lead) => `<article class="cwl-card"><div class="cwl-card-top"><div><strong>${esc(lead.name || lead.nome || "Lead")}</strong><span>${esc([lead.phone || lead.telefone, lead.origem || lead.campanha || lead.campaign, lead.createdAt].filter(Boolean).join(" - "))}</span></div></div><pre class="cwl-json-box">${esc(JSON.stringify(lead.camposFormulario || {}, null, 2))}</pre><div class="cwl-card-actions"><button data-action="lead-whatsapp" data-lead-id="${esc(lead.id)}">Abrir WhatsApp</button><button data-action="lead-pipeline" data-lead-id="${esc(lead.id)}">Adicionar ao Pipeline</button></div></article>`).join("") || `<p class="cwl-empty">Nenhum lead recebido do CODE Imob.</p>`}${leads.length > 120 ? `<p class="cwl-empty">Mostrando 120 de ${leads.length}. Use a busca para refinar.</p>` : ""}</div></article></section>`;
  }
  function renderDiagnostic() {
    const diagnostic = state.contextDiagnostic;
    const counts = diagnostic && diagnostic.counts ? diagnostic.counts : { pipelines: 0, etapas: 0, oportunidades: 0, clientes: 0, leads: 0 };
    const normalized = diagnostic && diagnostic.normalizedCounts ? diagnostic.normalizedCounts : null;
    const jsonText = diagnostic ? (diagnostic.rawText || JSON.stringify(diagnostic.rawJson, null, 2)) : "Clique em Atualizar Dados para executar code_whats_get_context().";
    const normalizedText = normalized ? `Normalizado pela extensão: pipelines ${normalized.pipelines}, etapas ${normalized.etapas}, oportunidades ${normalized.oportunidades}, clientes ${normalized.clientes}, leads ${normalized.leads}` : "";
    return `<h2>Diagnóstico code_whats_get_context</h2><div class="cwl-captured-grid"><article><span>Status HTTP</span><strong>${esc(diagnostic ? diagnostic.status : "-")}</strong></article><article><span>Pipelines</span><strong>${counts.pipelines}</strong></article><article><span>Etapas</span><strong>${counts.etapas}</strong></article><article><span>Oportunidades</span><strong>${counts.oportunidades}</strong></article><article><span>Clientes</span><strong>${counts.clientes}</strong></article><article><span>Leads</span><strong>${counts.leads}</strong></article></div>${normalizedText ? `<p class="cwl-empty">${esc(normalizedText)}</p>` : ""}${diagnostic && diagnostic.error ? `<p class="cwl-error">${esc(diagnostic.error)}</p>` : ""}<pre class="cwl-json-box" data-role="diagnostic-json">${esc(jsonText)}</pre><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-ghost" data-action="copy-diagnostic-json">Copiar JSON</button></div>`;
  }
  function renderSync() { return `<section class="cwl-card-panel cwl-sync-panel"><h2>Sincronização</h2><p>Status: <strong>${esc(state.syncStatus)}</strong></p><p>Eventos em runtime: ${(state.syncEvents || []).length}</p><p class="cwl-empty">O histórico é enviado manualmente pelo botão da conversa. Não há sincronização contínua nesta versão.</p><div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-primary" data-action="refresh-context">Atualizar Dados</button><button class="cwl-btn cwl-btn-ghost" data-action="logout">Sair</button></div>${renderDiagnostic()}</section>`; }  function renderModal() { if (!modal) return ""; if (modal.type === "leadPipeline") return renderLeadPipelineModal(); return ""; }
  function renderLeadPipelineModal() { const lead = state.leads.find((item) => item.id === modal.leadId); const funnel = activeFunnel(); return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="lead-pipeline-form"><header><h2>Adicionar ao Pipeline</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">x</button></header><p>${esc(lead && (lead.name || lead.nome))}</p><div class="cwl-form-grid"><label class="cwl-field"><span>Etapa</span><select name="stageId">${(funnel ? funnel.stages || funnel.etapas : []).map((stage) => `<option value="${esc(stage.id)}">${esc(stage.name || stage.nome)}</option>`).join("")}</select></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Enviar para CODE Imob</button></footer></form></div>`; }  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;

  async function openInWhatsApp(client) {
    const targetPhone = phone(client.phone || client.telefone);
    const targetName = clean(client.name || client.nome);
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    const url = targetPhone ? `https://web.whatsapp.com/send?phone=${targetPhone}` : "https://web.whatsapp.com/";
    if (!tabs.length) { await chrome.tabs.create({ url }); return; }
    try {
      const response = await chrome.tabs.sendMessage(tabs[0].id, { type: "CWL_OPEN_VISIBLE_CHAT", phone: targetPhone, name: targetName });
      if (response && response.opened) { await chrome.tabs.update(tabs[0].id, { active: true }); return; }
    } catch (error) {}
    await chrome.tabs.update(tabs[0].id, { active: true, url });
  }
  document.addEventListener("click", async (event) => { const target = event.target.closest("[data-action], .cwl-card"); if (!target) return; const action = target.dataset.action; if (!isAuthed() && action !== "close-modal") return; if (action === "section-pipeline") { section = "pipeline"; render(); } if (action === "section-clients") { section = "clients"; render(); } if (action === "section-leads") { section = "leads"; render(); } if (action === "logout") { state = await api.logout(); render(); } if (action === "client-filter") { clientFilter = target.dataset.filter || "todos"; render(); } if (action === "lead-filter") { leadFilter = target.dataset.filter || "todos"; render(); } if (action === "refresh-context") { state = await api.refreshFromCodeImob(); render(); } if (action === "copy-diagnostic-json") { const text = state.contextDiagnostic ? (state.contextDiagnostic.rawText || JSON.stringify(state.contextDiagnostic.rawJson, null, 2)) : ""; if (text) await navigator.clipboard.writeText(text); } if (action === "open-whatsapp") { const client = state.clients.find((item) => item.id === target.dataset.clientId) || { phone: target.dataset.phone, telefone: target.dataset.phone, name: target.dataset.name, nome: target.dataset.name }; openInWhatsApp(client); } if (action === "lead-whatsapp") { const lead = state.leads.find((item) => item.id === target.dataset.leadId); if (lead) openInWhatsApp({ phone: lead.phone || lead.telefone }); } if (action === "lead-pipeline") { modal = { type: "leadPipeline", leadId: target.dataset.leadId }; render(); } if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render(); } } });
  document.addEventListener("input", (event) => { if (event.target.matches('[data-action="search"]')) { query = event.target.value; render(); } });
  document.addEventListener("change", async (event) => { if (event.target.matches('[data-action="change-funnel"]')) { state.activeFunnelId = event.target.value; state = await api.saveState(state); render(); } });
  document.addEventListener("submit", async (event) => { if (event.target.matches('[data-role="login-form"]')) { event.preventDefault(); const data = new FormData(event.target); state = await api.login({ email: data.get("email"), password: data.get("password") }); render(); } if (event.target.matches('[data-role="lead-pipeline-form"]')) { event.preventDefault(); const lead = state.leads.find((item) => item.id === modal.leadId); const data = new FormData(event.target); if (lead) state = await api.addChatToPipeline({ chat: { name: lead.name || lead.nome, phone: lead.phone || lead.telefone, waKey: lead.id, messages: [] }, funnelId: state.activeFunnelId, stageId: data.get("stageId") }); modal = null; render(); } });
  document.addEventListener("dragstart", (event) => { const card = event.target.closest(".cwl-card"); if (card && card.dataset.opportunityId) event.dataTransfer.setData("application/cwl-opportunity", card.dataset.opportunityId); });
  document.addEventListener("dragover", (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (zone) { event.preventDefault(); zone.classList.add("is-over"); } });
  document.addEventListener("dragleave", (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (zone) zone.classList.remove("is-over"); });
  document.addEventListener("drop", async (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (!zone || !zone.dataset.stageId) return; event.preventDefault(); zone.classList.remove("is-over"); const opportunityId = event.dataTransfer.getData("application/cwl-opportunity"); if (opportunityId) { state = await api.moveOpportunity(opportunityId, zone.dataset.stageId); render(); } });

  async function boot() { state = await api.restoreSession(); render(); }
  boot();
})();



