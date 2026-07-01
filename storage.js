(function () {
  const SESSION_KEY = "codeWhatsSupabaseSession";
  const SyncStatus = Object.freeze({ OFFLINE: "offline", CONNECTING: "connecting", ONLINE: "online", ERROR: "error" });
  const now = () => new Date().toISOString();
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalizePhone = (value) => clean(value).replace(/\D/g, "");
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const initialState = () => ({
    authenticated: false,
    authSession: null,
    syncStatus: SyncStatus.OFFLINE,
    lastError: "",
    activeFunnelId: "",
    drawerOpen: true,
    activeView: "clients",
    funnels: [],
    clients: [],
    opportunities: [],
    leads: [],
    detectedChats: [],
    syncEvents: [],
    contextDiagnostic: null
  });

  let runtimeState = initialState();

  const config = () => window.CODE_WHATS_CONFIG || {};
  const supabaseUrl = () => clean(config().SUPABASE_URL).replace(/\/$/, "");
  const anonKey = () => clean(config().SUPABASE_ANON_KEY);
  const hasConfig = () => Boolean(supabaseUrl() && anonKey());
  const authHeaders = (session) => ({ apikey: anonKey(), Authorization: `Bearer ${(session && session.access_token) || anonKey()}`, "Content-Type": "application/json" });

  const officialCode = (error) => clean(error && (error.code || error.message || error.error_description || error.details || error.hint));
  const safeJson = (value) => { try { return JSON.stringify(value); } catch (error) { return String(value || ""); } };
  const mapOfficialError = (error) => {
    if (error && error.diagnosticMessage) return error.diagnosticMessage;
    const result = error && (error.rpcResult || error.loginResult);
    const payload = result ? result.payload : error;
    const raw = officialCode(payload || error);
    const known = {
      invalid_grant: "E-mail ou senha invÃƒÂ¡lidos.",
      invalid_credentials: "E-mail ou senha invÃƒÂ¡lidos.",
      not_authenticated: "SessÃƒÂ£o invÃƒÂ¡lida. FaÃƒÂ§a login novamente.",
      code_master_required: "UsuÃƒÂ¡rio sem CODE Master.",
      subscription_inactive: "Assinatura inativa.",
      assinatura_inativa: "Assinatura inativa.",
      inactive_subscription: "Assinatura inativa.",
      duplicate_cliente_phone: "Cliente jÃƒÂ¡ existente com este telefone.",
      duplicate_active_opportunity: "JÃƒÂ¡ existe uma oportunidade ativa para este cliente.",
      validate_login_failed: "RPC code_whats_validate_login retornou erro."
    };
    const base = known[raw] || raw || (result ? "RPC retornou erro." : "Erro oficial do CODE Imob.");
    if (result) return `${base} HTTP ${result.status}. JSON: ${safeJson(payload)}`;
    if (!raw && payload && typeof payload === "object") return `${base} JSON: ${safeJson(payload)}`;
    return base;
  };

  const normalizeStage = (stage) => ({ id: clean(stage.id || stage.etapa_id || stage.stage_id || stage.pipeline_stage_id), nome: clean(stage.nome || stage.name || stage.etapa_nome || stage.stage_name), name: clean(stage.nome || stage.name || stage.etapa_nome || stage.stage_name) });
  const normalizeFunnel = (funnel) => {
    const etapas = Array.isArray(funnel.etapas || funnel.stages) ? (funnel.etapas || funnel.stages).map(normalizeStage).filter((stage) => stage.id) : [];
    return { id: clean(funnel.id || funnel.funil_id || funnel.funnel_id || funnel.pipeline_id), nome: clean(funnel.nome || funnel.name || funnel.funil_nome || funnel.pipeline_name || "Pipeline CODE Imob"), name: clean(funnel.nome || funnel.name || funnel.funil_nome || funnel.pipeline_name || "Pipeline CODE Imob"), etapas, stages: etapas };
  };
  const normalizeClient = (client) => ({ id: clean(client.id || client.cliente_id || client.client_id), nome: clean(client.nome || client.name || client.cliente_nome || client.client_name), name: clean(client.nome || client.name || client.cliente_nome || client.client_name), telefone: normalizePhone(client.telefone || client.phone || client.whatsapp || client.celular), phone: normalizePhone(client.telefone || client.phone || client.whatsapp || client.celular), waKey: clean(client.waKey || client.wa_key), origem: clean(client.origem || client.source), updatedAt: client.updatedAt || client.updated_at || now() });
  const normalizeOpportunity = (opportunity, fallbackStageId = "", fallbackFunnelId = "") => {
    const client = opportunity.cliente || opportunity.client || {};
    const opportunityId = clean(opportunity.oportunidade_id || opportunity.opportunity_id || opportunity.pipeline_lead_id || opportunity.pipelineLeadId || opportunity.pipelineLeadID || opportunity.id);
    return {
      ...opportunity,
      raw: opportunity,
      id: opportunityId,
      opportunityId,
      clientId: clean(opportunity.clientId || opportunity.clienteId || opportunity.cliente_id || opportunity.client_id || client.id || client.cliente_id || client.client_id),
      clientName: clean(opportunity.clientName || opportunity.clienteNome || opportunity.cliente_nome || opportunity.nome || opportunity.name || client.nome || client.name),
      clientPhone: normalizePhone(opportunity.clientPhone || opportunity.clienteTelefone || opportunity.cliente_telefone || opportunity.telefone || opportunity.phone || client.telefone || client.phone),
      funnelId: clean(opportunity.funnelId || opportunity.funilId || opportunity.funil_id || opportunity.funnel_id || opportunity.pipeline_id || fallbackFunnelId),
      stageId: clean(opportunity.stageId || opportunity.etapaId || opportunity.etapa_id || opportunity.stage_id || opportunity.pipeline_stage_id || (opportunity.stage && opportunity.stage.id) || (opportunity.etapa && opportunity.etapa.id) || fallbackStageId),
      status: clean(opportunity.status || opportunity.situacao || "active"),
      value: opportunity.value || opportunity.valor || opportunity.amount || "",
      updatedAt: opportunity.updatedAt || opportunity.updated_at || now()
    };
  };
  const normalizeLead = (lead) => ({ id: clean(lead.id || lead.lead_id), nome: clean(lead.nome || lead.name), name: clean(lead.nome || lead.name), telefone: normalizePhone(lead.telefone || lead.phone), phone: normalizePhone(lead.telefone || lead.phone), origem: clean(lead.origem || lead.source), createdAt: lead.createdAt || lead.created_at || "", formulario: lead.formulario || lead.form || {}, camposFormulario: lead.camposFormulario || lead.form_fields || lead.formFields || lead.camposExtras || {} });
  const normalizeDetectedChat = (chat) => ({ key: clean(chat.key || chat.waKey) || `${clean(chat.nome || chat.name)}|${now()}`, waKey: clean(chat.waKey || chat.key), nome: clean(chat.nome || chat.name || chat.chatTitle), name: clean(chat.nome || chat.name || chat.chatTitle), telefone: normalizePhone(chat.telefone || chat.phone), phone: normalizePhone(chat.telefone || chat.phone), ultimaMensagem: clean(chat.ultimaMensagem || chat.lastMessage), lastMessage: clean(chat.ultimaMensagem || chat.lastMessage), ultimoContato: clean(chat.ultimoContato || chat.lastMessageTime), lastMessageTime: clean(chat.ultimoContato || chat.lastMessageTime), messages: Array.isArray(chat.messages) ? chat.messages.slice(-2) : [], capturedAt: chat.capturedAt || now() });

  const normalizeContext = (context) => {
    const data = context && context.data && typeof context.data === "object" ? context.data : context || {};
    const pipeline = data.pipeline && typeof data.pipeline === "object" && !Array.isArray(data.pipeline) ? data.pipeline : {};
    const pipelineStages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
    const sourceFunnels = data.funnels || data.funis || (Array.isArray(data.pipeline) ? data.pipeline : (pipelineStages.length ? [{ ...pipeline, id: pipeline.id || pipeline.funil_id || pipeline.funnel_id || pipeline.pipeline_id || "pipeline", etapas: pipelineStages }] : []));
    const funnels = Array.isArray(sourceFunnels) ? sourceFunnels.map(normalizeFunnel).filter((funnel) => funnel.id) : [];
    const clients = Array.isArray(data.clients || data.clientes) ? (data.clients || data.clientes).map(normalizeClient).filter((client) => client.id) : [];
    const directOpportunities = data.opportunities || data.oportunidades || pipeline.opportunities || [];
    const nestedOpportunities = pipelineStages.flatMap((stage) => {
      const stageId = clean(stage.id || stage.etapa_id || stage.stage_id || stage.pipeline_stage_id);
      return (stage.opportunities || stage.oportunidades || stage.pipeline_leads || stage.leads || []).map((item) => ({ ...item, stage_id: item.stage_id || item.etapa_id || item.pipeline_stage_id || stageId }));
    });
    const sourceOpportunities = [...(Array.isArray(directOpportunities) ? directOpportunities : []), ...nestedOpportunities];
    const fallbackFunnelId = funnels[0] ? funnels[0].id : clean(pipeline.id || pipeline.funil_id || pipeline.funnel_id || pipeline.pipeline_id);
    const opportunities = sourceOpportunities.map((item) => normalizeOpportunity(item, "", fallbackFunnelId)).filter((item) => item.id && item.stageId);
    const leads = Array.isArray(data.leads) ? data.leads.map(normalizeLead).filter((lead) => lead.id) : [];
    return { funnels, clients, opportunities, leads };
  };
  const contextCounts = (context) => ({
    pipelines: (context.funnels || []).length,
    etapas: (context.funnels || []).reduce((total, funnel) => total + ((funnel.stages || funnel.etapas || []).length), 0),
    oportunidades: (context.opportunities || []).length,
    clientes: (context.clients || []).length,
    leads: (context.leads || []).length
  });
  const rawContextCounts = (context) => {
    const data = context && context.data && typeof context.data === "object" ? context.data : context || {};
    const pipeline = data.pipeline && typeof data.pipeline === "object" && !Array.isArray(data.pipeline) ? data.pipeline : {};
    const sourceFunnels = data.funnels || data.funis || (Array.isArray(data.pipeline) ? data.pipeline : (Array.isArray(pipeline.stages) ? [pipeline] : []));
    const sourceOpportunities = data.opportunities || data.oportunidades || pipeline.opportunities;
    return {
      pipelines: Array.isArray(sourceFunnels) ? sourceFunnels.length : 0,
      etapas: Array.isArray(sourceFunnels) ? sourceFunnels.reduce((total, funnel) => total + ((funnel.stages || funnel.etapas || []).length), 0) : 0,
      oportunidades: Array.isArray(sourceOpportunities) ? sourceOpportunities.length : 0,
      clientes: Array.isArray(data.clients || data.clientes) ? (data.clients || data.clientes).length : 0,
      leads: Array.isArray(data.leads) ? data.leads.length : 0
    };
  };

  const setState = (patch) => {
    runtimeState = { ...runtimeState, ...patch };
    runtimeState.detectedChats = Array.isArray(runtimeState.detectedChats) ? runtimeState.detectedChats.map(normalizeDetectedChat) : [];
    runtimeState.authenticated = Boolean(runtimeState.authSession && runtimeState.authSession.access_token);
    if (!runtimeState.funnels.some((funnel) => funnel.id === runtimeState.activeFunnelId)) runtimeState.activeFunnelId = runtimeState.funnels[0] ? runtimeState.funnels[0].id : "";
    return clone(runtimeState);
  };

  const sessionStore = {
    get: () => new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.session) { resolve(null); return; }
      chrome.storage.session.get([SESSION_KEY], (result) => resolve(result && result[SESSION_KEY]));
    }),
    set: (session) => new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.session) { resolve(); return; }
      chrome.storage.session.set({ [SESSION_KEY]: session }, resolve);
    }),
    clear: () => new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.session) { resolve(); return; }
      chrome.storage.session.remove([SESSION_KEY], resolve);
    })
  };

  const rpcDetailed = async (name, params = {}, session = runtimeState.authSession) => {
    if (!hasConfig()) throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY em code-whats.config.js.");
    if (!session || !session.access_token) throw new Error("not_authenticated");
    const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, { method: "POST", headers: authHeaders(session), body: JSON.stringify(params || {}) });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (parseError) { const err = new Error("Resposta invÃƒÂ¡lida da RPC."); err.rpcResult = { status: response.status, ok: response.ok, rawText: text, payload: text }; throw err; }
    const result = { status: response.status, ok: response.ok, rawText: text, payload };
    if (!response.ok) { const err = new Error(mapOfficialError(payload)); err.rpcResult = result; throw err; }
    if (payload && payload.error) { const err = new Error(mapOfficialError(payload.error)); err.rpcResult = result; throw err; }
    return result;
  };
  const rpc = async (name, params = {}, session = runtimeState.authSession) => (await rpcDetailed(name, params, session)).payload;

  const firstRow = (value) => Array.isArray(value) ? value[0] : (value && value.data && Array.isArray(value.data) ? value.data[0] : (value && value.data ? value.data : value));

  const CodeImobProvider = {
    login: async ({ email, password }) => {
      if (!hasConfig()) throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY em code-whats.config.js.");
      const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey(), "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const text = await response.text();
      const session = text ? JSON.parse(text) : null;
      const loginResult = { status: response.status, ok: response.ok, rawText: text, payload: session };
      if (!response.ok) { const err = new Error(mapOfficialError(session)); err.officialCode = officialCode(session); err.loginResult = loginResult; throw err; }
      if (!session || !session.access_token) { const err = new Error("not_authenticated"); err.loginResult = loginResult; err.diagnosticMessage = `Login Auth nÃƒÂ£o retornou access_token. HTTP ${response.status}. JSON: ${safeJson(session)}`; throw err; }
      const validationResult = await rpcDetailed("code_whats_validate_login", {}, session);
      const validation = firstRow(validationResult.payload) || {};
      const validationError = (code, message) => { const err = new Error(code); err.rpcResult = validationResult; err.validation = validation; err.diagnosticMessage = `${message} HTTP ${validationResult.status}. JSON: ${safeJson(validationResult.payload)}`; return err; };
      if (validation.authenticated !== true) throw validationError("not_authenticated", "SessÃƒÂ£o invÃƒÂ¡lida. FaÃƒÂ§a login novamente.");
      if (validation.has_code_master !== true) throw validationError("code_master_required", "UsuÃƒÂ¡rio sem CODE Master.");
      if (validation.ok !== true) {
        const inactive = [validation.assinatura_ativa, validation.subscription_active, validation.has_active_subscription, validation.active_subscription, validation.plano_ativo].some((value) => value === false);
        throw validationError(inactive ? "subscription_inactive" : "validate_login_failed", inactive ? "Assinatura inativa." : "RPC code_whats_validate_login retornou erro.");
      }
      await sessionStore.set(session);
      return session;
    },
    logout: async (session) => {
      if (hasConfig() && session && session.access_token) {
        await fetch(`${supabaseUrl()}/auth/v1/logout`, { method: "POST", headers: authHeaders(session) }).catch(() => null);
      }
      await sessionStore.clear();
    },
    getContext: () => rpc("code_whats_get_context"),
    getContextDiagnostic: () => rpcDetailed("code_whats_get_context"),
    findClientByPhone: (phone) => rpc("code_whats_find_cliente_by_phone", { p_phone: normalizePhone(phone) }),
    createClientIfNotExists: ({ nome, telefone, email, origem, observacoes }) => rpc("code_whats_create_cliente_if_not_exists", { p_phone: normalizePhone(telefone), p_nome: clean(nome), p_email: clean(email), p_origem: clean(origem || "CODE Whats"), p_observacoes: clean(observacoes) }),
    createOpportunity: ({ nome, telefone, email, origem, valor, stageId, tipoCliente }) => rpc("code_whats_create_opportunity", { p_phone: normalizePhone(telefone), p_nome: clean(nome), p_email: clean(email), p_origem: clean(origem || "CODE Whats"), p_valor: Number(valor || 0), p_stage_id: stageId, p_tipo_cliente: clean(tipoCliente || "CODE Whats") }),
    moveOpportunity: ({ opportunityId, stageId }) => rpc("code_whats_update_opportunity_stage", { p_opportunity_id: clean(opportunityId), p_stage_id: clean(stageId) }),
    saveLastMessages: ({ phone, messages }) => rpc("code_whats_save_last_messages", { p_phone: normalizePhone(phone), p_messages: messages || [] })
  };

  const getState = () => Promise.resolve(clone(runtimeState));
  const saveState = (state) => Promise.resolve(setState({ drawerOpen: state.drawerOpen, activeView: state.activeView, activeFunnelId: state.activeFunnelId }));

  const refreshFromCodeImob = async () => {
    if (!runtimeState.authSession) return getState();
    setState({ syncStatus: SyncStatus.CONNECTING, lastError: "" });
    try {
      const result = await CodeImobProvider.getContextDiagnostic();
      const normalized = normalizeContext(result.payload);
      return setState({ ...normalized, contextDiagnostic: { rpc: "code_whats_get_context", status: result.status, ok: result.ok, rawText: result.rawText, rawJson: result.payload, counts: rawContextCounts(result.payload), normalizedCounts: contextCounts(normalized), error: "" }, syncStatus: SyncStatus.ONLINE, lastError: "" });
    } catch (error) {
      const result = error && error.rpcResult;
      return setState({ contextDiagnostic: { rpc: "code_whats_get_context", status: result ? result.status : 0, ok: false, rawText: result ? result.rawText : "", rawJson: result ? result.payload : null, counts: contextCounts(runtimeState), error: error && (error.stack || error.message || String(error)) }, syncStatus: SyncStatus.ERROR, lastError: mapOfficialError(error) });
    }
  };

  const restoreSession = async () => {
    const session = await sessionStore.get();
    if (!session || !session.access_token) return getState();
    setState({ authSession: session, syncStatus: SyncStatus.CONNECTING });
    return refreshFromCodeImob();
  };

  const login = async (credentials) => {
    setState({ syncStatus: SyncStatus.CONNECTING, lastError: "" });
    try {
      const session = await CodeImobProvider.login(credentials);
      setState({ authSession: session, syncStatus: SyncStatus.ONLINE });
      return refreshFromCodeImob();
    } catch (error) {
      await sessionStore.clear();
      return setState({ authSession: null, syncStatus: SyncStatus.ERROR, lastError: mapOfficialError(error) });
    }
  };

  const logout = async () => {
    await CodeImobProvider.logout(runtimeState.authSession);
    runtimeState = initialState();
    return clone(runtimeState);
  };

  const saveDetectedChats = (detectedChats) => {
    runtimeState.detectedChats = Array.isArray(detectedChats) ? detectedChats.map(normalizeDetectedChat).slice(0, 80) : [];
    return getState();
  };

  const addChatToPipeline = async ({ chat, funnelId, stageId }) => {
    const telefone = normalizePhone(chat.telefone || chat.phone);
    const nome = clean(chat.nome || chat.name);
    if (!telefone) return setState({ syncStatus: SyncStatus.ERROR, lastError: "Telefone n\u00e3o encontrado na conversa." });
    setState({ syncStatus: SyncStatus.CONNECTING, lastError: "" });
    try {
      await CodeImobProvider.createClientIfNotExists({ nome, telefone, origem: "CODE Whats", observacoes: "CODE Whats" });
      await CodeImobProvider.createOpportunity({ nome, telefone, origem: "CODE Whats", stageId, tipoCliente: "CODE Whats" });
      return refreshFromCodeImob();
    } catch (error) {
      await refreshFromCodeImob();
      return setState({ syncStatus: SyncStatus.ERROR, lastError: mapOfficialError(error) });
    }
  };

  const formatHistoryText = (message) => {
    const author = clean(message.autor || message.authorName || message.author || message.remetente || (message.tipo_autor === "corretor" ? "Corretor" : "Cliente")).replace(/\[unknown\]/gi, "") || "Cliente";
    const time = clean(message.hora || message.time);
    const content = clean(message.conteudo || message.content || message.text).replace(/\[unknown\]/gi, "");
    const header = [author, time].filter(Boolean).join(" \u2014 ");
    return [header, content].filter(Boolean).join("\n");
  };

  const normalizeHistoryMessage = (message) => {
    const conteudo = clean(message && (message.conteudo || message.content || message.text)).replace(/\[unknown\]/gi, "");
    const tipoAutor = clean(message && (message.tipo_autor || message.authorType)).toLowerCase() === "corretor" ? "corretor" : "cliente";
    const autor = clean(message && (message.autor || message.authorName || message.author || message.remetente)).replace(/\[unknown\]/gi, "") || (tipoAutor === "corretor" ? "Corretor" : "Cliente");
    return {
      ...message,
      autor,
      tipo_autor: tipoAutor,
      data: clean(message && (message.data || message.date)),
      hora: clean(message && (message.hora || message.time)),
      tipo: clean(message && (message.tipo || message.type)) || "texto",
      conteudo,
      text: formatHistoryText({ ...message, autor, tipo_autor: tipoAutor, conteudo })
    };
  };

  const saveChatHistory = async ({ phone, messages }) => {
    const telefone = normalizePhone(phone);
    const capturedMessages = Array.isArray(messages) ? messages.map(normalizeHistoryMessage).filter((item) => clean(item.conteudo || item.text)) : [];
    if (!telefone) return setState({ syncStatus: SyncStatus.ERROR, lastError: "Telefone não encontrado na conversa." });
    if (!capturedMessages.length) return setState({ syncStatus: SyncStatus.ERROR, lastError: "Nenhuma mensagem selecionada para enviar ao hist\u00f3rico." });
    setState({ syncStatus: SyncStatus.CONNECTING, lastError: "" });
    try {
      await CodeImobProvider.saveLastMessages({ phone: telefone, messages: capturedMessages });
      return setState({ syncStatus: SyncStatus.ONLINE, lastError: "" });
    } catch (error) {
      return setState({ syncStatus: SyncStatus.ERROR, lastError: mapOfficialError(error) });
    }
  };
  const moveOpportunity = async (opportunityId, stageId) => {
    setState({ syncStatus: SyncStatus.CONNECTING, lastError: "" });
    try {
      await CodeImobProvider.moveOpportunity({ opportunityId, stageId });
      return refreshFromCodeImob();
    } catch (error) {
      await refreshFromCodeImob();
      return setState({ syncStatus: SyncStatus.ERROR, lastError: mapOfficialError(error) });
    }
  };

  window.CodeImobProvider = CodeImobProvider;
  window.CodeSyncProvider = CodeImobProvider;
  window.CodeWhatsStorage = { SyncStatus, getState, saveState, restoreSession, login, logout, refreshFromCodeImob, saveDetectedChats, addChatToPipeline, saveChatHistory, moveOpportunity };
})();


