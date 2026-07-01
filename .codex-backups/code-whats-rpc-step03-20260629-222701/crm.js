(function () {
  const api = window.CodeWhatsStorage;
  let state = null;
  let modal = null;
  let query = "";
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
        <div class="cwl-inline-actions"><button class="cwl-btn cwl-btn-ghost" data-action="section-pipeline">Pipeline</button><button class="cwl-btn cwl-btn-ghost" data-action="section-clients">Clientes</button><button class="cwl-btn cwl-btn-ghost" data-action="section-leads">Leads</button><button class="cwl-btn cwl-btn-ghost" data-action="section-sync">Sincronização</button></div>
        <div class="cwl-inline-actions"><label class="cwl-field"><span>Funil</span><select data-action="change-funnel">${state.funnels.map((funnel) => `<option value="${esc(funnel.id)}" ${funnel.id === state.activeFunnelId ? "selected" : ""}>${esc(funnel.name || funnel.nome)}</option>`).join("")}</select></label><input class="cwl-crm-search" data-action="search" placeholder="Buscar" value="${esc(query)}"></div>
      </header>
      <section class="cwl-sync-warning">Pipeline, clientes e leads são dados oficiais do CODE Imob. Esta janela apenas renderiza e envia ações para a plataforma.</section>
      ${section === "clients" ? renderClients() : section === "leads" ? renderLeads() : section === "sync" ? renderSync() : renderPipeline()}
      ${renderModal()}
    `;
  }

  function renderLogin() { return `<section class="cwl-crm-app"><div class="cwl-card-panel cwl-login-screen"><p class="cwl-kicker">CODE Imob</p><h1>Login obrigatório</h1><p>Autentique-se para acessar Pipeline, Clientes, Leads e Sincronização.</p><form data-role="login-form" class="cwl-form-grid">${input("E-mail", "email", "", "email", true)}${input("Senha", "password", "", "password", true)}<button class="cwl-btn cwl-btn-primary" type="submit">Entrar</button></form>${state && state.lastError ? `<p class="cwl-error">${esc(state.lastError)}</p>` : `<p class="cwl-empty">Supabase Auth oficial ainda será conectado. Não há login mockado.</p>`}</div></section>`; }

  function renderPipeline() {
    const funnel = activeFunnel();
    if (!funnel) return `<section class="cwl-card-panel"><p class="cwl-empty">Nenhum pipeline recebido do CODE Imob.</p></section>`;
    return `<section class="cwl-crm-board">${(funnel.stages || funnel.etapas || []).map(renderStage).join("")}</section>`;
  }
  function renderStage(stage) { const items = opportunitiesFor(stage.id); return `<article class="cwl-crm-column" data-stage-id="${esc(stage.id)}"><header><h2>${esc(stage.name || stage.nome)}</h2><span>${items.length}</span></header><div class="cwl-crm-dropzone" data-stage-id="${esc(stage.id)}">${items.map(renderOpportunity).join("") || `<p class="cwl-empty">Sem oportunidades.</p>`}</div></article>`; }
  function renderOpportunity(opportunity) { const client = clientFor(opportunity.clientId); return `<article class="cwl-card" draggable="true" data-opportunity-id="${esc(opportunity.id)}"><div class="cwl-card-top"><div><strong>${esc(client.name || client.nome || "Cliente")}</strong><span>${esc(client.phone || client.telefone || "sem telefone")}</span></div><em class="cwl-temp cwl-temp-morno">${esc(opportunity.status || "active")}</em></div><div class="cwl-card-actions"><button data-action="open-whatsapp" data-client-id="${esc(client.id)}">Abrir WhatsApp</button><button data-action="delete-opportunity" data-opportunity-id="${esc(opportunity.id)}">Excluir oportunidade</button></div></article>`; }

  function renderClients() { const q = query.toLowerCase(); const clients = state.clients.filter((client) => !q || [client.name, client.nome, client.phone, client.telefone].join(" ").toLowerCase().includes(q)); return `<section class="cwl-leads-board"><article class="cwl-crm-column"><header><h2>Clientes CODE Imob</h2><span>${clients.length}</span></header><div class="cwl-crm-dropzone">${clients.map((client) => `<article class="cwl-card"><div class="cwl-card-top"><div><strong>${esc(client.name || client.nome)}</strong><span>${esc(client.phone || client.telefone)}</span></div></div><div class="cwl-card-actions"><button data-action="open-whatsapp" data-client-id="${esc(client.id)}">Abrir WhatsApp</button></div></article>`).join("") || `<p class="cwl-empty">Nenhum cliente recebido do CODE Imob.</p>`}</div></article></section>`; }
  function renderLeads() { const q = query.toLowerCase(); const leads = state.leads.filter((lead) => !q || [lead.name, lead.nome, lead.phone, lead.telefone, lead.origem].join(" ").toLowerCase().includes(q)); return `<section class="cwl-leads-board"><article class="cwl-crm-column"><header><h2>Leads CODE Imob</h2><span>${leads.length}</span></header><div class="cwl-crm-dropzone">${leads.map((lead) => `<article class="cwl-card"><div class="cwl-card-top"><div><strong>${esc(lead.name || lead.nome)}</strong><span>${esc([lead.phone || lead.telefone, lead.origem, lead.createdAt].filter(Boolean).join(" · "))}</span></div></div><pre class="cwl-json-box">${esc(JSON.stringify(lead.camposFormulario || {}, null, 2))}</pre><div class="cwl-card-actions"><button data-action="lead-whatsapp" data-lead-id="${esc(lead.id)}">Abrir WhatsApp</button><button data-action="lead-pipeline" data-lead-id="${esc(lead.id)}">Adicionar ao Pipeline</button></div></article>`).join("") || `<p class="cwl-empty">Nenhum lead recebido do CODE Imob.</p>`}</div></article></section>`; }
  function renderSync() { return `<section class="cwl-card-panel"><h2>Sincronização automática</h2><p>Status: <strong>${esc(state.syncStatus)}</strong></p><p>Eventos em runtime: ${(state.syncEvents || []).length}</p><p class="cwl-empty">Realtime e Edge Functions serão responsáveis por refletir alterações do CODE Imob e enviar ações da extensão imediatamente.</p><button class="cwl-btn cwl-btn-ghost" data-action="logout">Sair</button></section>`; }
  function renderModal() { if (!modal) return ""; if (modal.type === "leadPipeline") return renderLeadPipelineModal(); return ""; }
  function renderLeadPipelineModal() { const lead = state.leads.find((item) => item.id === modal.leadId); const funnel = activeFunnel(); return `<div class="cwl-modal-backdrop" data-action="close-modal"><form class="cwl-modal" data-role="lead-pipeline-form"><header><h2>Adicionar ao Pipeline</h2><button type="button" class="cwl-icon-btn" data-action="close-modal">×</button></header><p>${esc(lead && (lead.name || lead.nome))}</p><div class="cwl-form-grid"><label class="cwl-field"><span>Etapa</span><select name="stageId">${(funnel ? funnel.stages || funnel.etapas : []).map((stage) => `<option value="${esc(stage.id)}">${esc(stage.name || stage.nome)}</option>`).join("")}</select></label></div><footer><button class="cwl-btn cwl-btn-ghost" type="button" data-action="close-modal">Cancelar</button><button class="cwl-btn cwl-btn-primary" type="submit">Enviar para CODE Imob</button></footer></form></div>`; }
  const input = (label, name, value, type = "text", required = false) => `<label class="cwl-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;

  async function openInWhatsApp(client) { const targetPhone = phone(client.phone || client.telefone); const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" }); const url = targetPhone ? `https://web.whatsapp.com/send?phone=${targetPhone}` : "https://web.whatsapp.com/"; if (!tabs.length) { await chrome.tabs.create({ url }); return; } await chrome.tabs.update(tabs[0].id, { active: true, url }); }

  document.addEventListener("click", async (event) => { const target = event.target.closest("[data-action], .cwl-card"); if (!target) return; const action = target.dataset.action; if (!isAuthed() && action !== "close-modal") return; if (action === "section-pipeline") { section = "pipeline"; render(); } if (action === "section-clients") { section = "clients"; render(); } if (action === "section-leads") { section = "leads"; render(); } if (action === "section-sync") { section = "sync"; render(); } if (action === "logout") { state = await api.logout(); render(); } if (action === "open-whatsapp") { const client = state.clients.find((item) => item.id === target.dataset.clientId); if (client) openInWhatsApp(client); } if (action === "lead-whatsapp") { const lead = state.leads.find((item) => item.id === target.dataset.leadId); if (lead) openInWhatsApp({ phone: lead.phone || lead.telefone }); } if (action === "lead-pipeline") { modal = { type: "leadPipeline", leadId: target.dataset.leadId }; render(); } if (action === "delete-opportunity") { if (confirm("Excluir oportunidade no CODE Imob?")) { state = await api.deleteOpportunity(target.dataset.opportunityId); render(); } } if (action === "close-modal") { if (target.matches("button") || target === event.target) { modal = null; render(); } } });
  document.addEventListener("input", (event) => { if (event.target.matches('[data-action="search"]')) { query = event.target.value; render(); } });
  document.addEventListener("change", async (event) => { if (event.target.matches('[data-action="change-funnel"]')) { state.activeFunnelId = event.target.value; state = await api.saveState(state); render(); } });
  document.addEventListener("submit", async (event) => { if (event.target.matches('[data-role="login-form"]')) { event.preventDefault(); const data = new FormData(event.target); state = await api.login({ email: data.get("email"), password: data.get("password") }); render(); } if (event.target.matches('[data-role="lead-pipeline-form"]')) { event.preventDefault(); const lead = state.leads.find((item) => item.id === modal.leadId); const data = new FormData(event.target); if (lead) state = await api.addChatToPipeline({ chat: { name: lead.name || lead.nome, phone: lead.phone || lead.telefone, waKey: lead.id, messages: [] }, funnelId: state.activeFunnelId, stageId: data.get("stageId") }); modal = null; render(); } });
  document.addEventListener("dragstart", (event) => { const card = event.target.closest(".cwl-card"); if (card && card.dataset.opportunityId) event.dataTransfer.setData("application/cwl-opportunity", card.dataset.opportunityId); });
  document.addEventListener("dragover", (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (zone) { event.preventDefault(); zone.classList.add("is-over"); } });
  document.addEventListener("dragleave", (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (zone) zone.classList.remove("is-over"); });
  document.addEventListener("drop", async (event) => { const zone = event.target.closest(".cwl-crm-dropzone"); if (!zone || !zone.dataset.stageId) return; event.preventDefault(); zone.classList.remove("is-over"); const opportunityId = event.dataTransfer.getData("application/cwl-opportunity"); if (opportunityId) { state = await api.moveOpportunity(opportunityId, zone.dataset.stageId); render(); } });

  async function boot() { state = await api.getState(); render(); }
  boot();
})();

