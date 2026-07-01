(function () {
  const SyncStatus = Object.freeze({ OFFLINE: "offline", CONNECTING: "connecting", ONLINE: "online", ERROR: "error" });
  const now = () => new Date().toISOString();
  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
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
    syncEvents: []
  });

  let runtimeState = initialState();

  const normalizeFunnel = (funnel) => ({
    id: clean(funnel.id),
    nome: clean(funnel.nome || funnel.name),
    name: clean(funnel.nome || funnel.name),
    etapas: Array.isArray(funnel.etapas || funnel.stages) ? (funnel.etapas || funnel.stages).map((stage) => ({ id: clean(stage.id), nome: clean(stage.nome || stage.name), name: clean(stage.nome || stage.name) })).filter((stage) => stage.id) : [],
    stages: Array.isArray(funnel.etapas || funnel.stages) ? (funnel.etapas || funnel.stages).map((stage) => ({ id: clean(stage.id), nome: clean(stage.nome || stage.name), name: clean(stage.nome || stage.name) })).filter((stage) => stage.id) : []
  });
  const normalizeClient = (client) => ({ id: clean(client.id), nome: clean(client.nome || client.name), name: clean(client.nome || client.name), telefone: normalizePhone(client.telefone || client.phone), phone: normalizePhone(client.telefone || client.phone), waKey: clean(client.waKey), origem: clean(client.origem || client.source), updatedAt: client.updatedAt || now() });
  const normalizeOpportunity = (opportunity) => ({ id: clean(opportunity.id), clientId: clean(opportunity.clientId || opportunity.clienteId), funnelId: clean(opportunity.funnelId || opportunity.funilId), stageId: clean(opportunity.stageId || opportunity.etapaId), status: clean(opportunity.status || "active"), updatedAt: opportunity.updatedAt || now() });
  const normalizeLead = (lead) => ({ id: clean(lead.id), nome: clean(lead.nome || lead.name), name: clean(lead.nome || lead.name), telefone: normalizePhone(lead.telefone || lead.phone), phone: normalizePhone(lead.telefone || lead.phone), origem: clean(lead.origem || lead.source), createdAt: lead.createdAt || "", formulario: lead.formulario || lead.form || {}, camposFormulario: lead.camposFormulario || lead.formFields || lead.camposExtras || {} });
  const normalizeDetectedChat = (chat) => ({ key: clean(chat.key || chat.waKey) || uid("chat"), waKey: clean(chat.waKey || chat.key) || uid("chat"), nome: clean(chat.nome || chat.name || chat.chatTitle), name: clean(chat.nome || chat.name || chat.chatTitle), telefone: normalizePhone(chat.telefone || chat.phone), phone: normalizePhone(chat.telefone || chat.phone), ultimaMensagem: clean(chat.ultimaMensagem || chat.lastMessage), lastMessage: clean(chat.ultimaMensagem || chat.lastMessage), ultimoContato: clean(chat.ultimoContato || chat.lastMessageTime), lastMessageTime: clean(chat.ultimoContato || chat.lastMessageTime), messages: Array.isArray(chat.messages) ? chat.messages.slice(-2) : [], capturedAt: chat.capturedAt || now() });
  const normalizeEvent = (event) => ({ id: event.id || uid("event"), type: clean(event.type), payload: event.payload && typeof event.payload === "object" ? event.payload : {}, createdAt: event.createdAt || now(), syncStatus: clean(event.syncStatus || "pending") });

  const normalizeState = (state) => {
    const next = { ...initialState(), ...state };
    next.funnels = Array.isArray(next.funnels || next.funis) ? (next.funnels || next.funis).map(normalizeFunnel).filter((funnel) => funnel.id) : [];
    next.clients = Array.isArray(next.clients || next.clientes) ? (next.clients || next.clientes).map(normalizeClient).filter((client) => client.id) : [];
    next.opportunities = Array.isArray(next.opportunities) ? next.opportunities.map(normalizeOpportunity).filter((item) => item.id) : [];
    next.leads = Array.isArray(next.leads) ? next.leads.map(normalizeLead).filter((lead) => lead.id) : [];
    next.detectedChats = Array.isArray(next.detectedChats) ? next.detectedChats.map(normalizeDetectedChat) : [];
    next.syncEvents = Array.isArray(next.syncEvents) ? next.syncEvents.map(normalizeEvent) : [];
    next.authenticated = Boolean(next.authSession);
    if (!next.funnels.some((funnel) => funnel.id === next.activeFunnelId)) next.activeFunnelId = next.funnels[0] ? next.funnels[0].id : "";
    return next;
  };

  // CODE Imob integration boundary.
  // Supabase Auth: replace login/logout with official session validation and token refresh.
  // Supabase Realtime: loadFunnels/loadClients/loadLeads should subscribe to live changes from CODE Imob.
  // Supabase Storage: future attachments must use private buckets and signed URLs.
  // Supabase Edge Functions: mutations below should call server-side functions that own business rules.
  // Supabase RLS: all tables must enforce CODE Master user permissions in the main platform.
  const CodeImobProvider = {
    login: () => Promise.reject(new Error("Autenticação CODE Imob ainda não conectada.")),
    logout: () => Promise.resolve(),
    loadFunnels: () => Promise.resolve([]),
    loadClients: () => Promise.resolve([]),
    loadOpportunities: () => Promise.resolve([]),
    loadLeads: () => Promise.resolve([]),
    findClientByPhone: () => Promise.resolve(null),
    createClient: () => Promise.reject(new Error("API CODE Imob indisponível.")),
    findActiveOpportunity: () => Promise.resolve(null),
    createOpportunity: () => Promise.reject(new Error("API CODE Imob indisponível.")),
    moveOpportunity: () => Promise.reject(new Error("API CODE Imob indisponível.")),
    deleteOpportunity: () => Promise.reject(new Error("API CODE Imob indisponível.")),
    appendHistory: () => Promise.reject(new Error("API CODE Imob indisponível.")),
    pushEvent: (event) => Promise.resolve(event)
  };

  const setState = (patch) => { runtimeState = normalizeState({ ...runtimeState, ...patch }); return clone(runtimeState); };
  const getState = () => Promise.resolve(clone(runtimeState));
  const saveState = (state) => Promise.resolve(setState(state));
  const addRuntimeEvent = (type, payload) => {
    const event = normalizeEvent({ type, payload });
    runtimeState.syncEvents.unshift(event);
    return event;
  };

  const refreshFromCodeImob = async () => {
    if (!runtimeState.authSession) return getState();
    runtimeState.syncStatus = SyncStatus.CONNECTING;
    try {
      const [funnels, clients, opportunities, leads] = await Promise.all([
        CodeImobProvider.loadFunnels(runtimeState.authSession),
        CodeImobProvider.loadClients(runtimeState.authSession),
        CodeImobProvider.loadOpportunities(runtimeState.authSession),
        CodeImobProvider.loadLeads(runtimeState.authSession)
      ]);
      return setState({ funnels, clients, opportunities, leads, syncStatus: SyncStatus.ONLINE, lastError: "" });
    } catch (error) {
      return setState({ syncStatus: SyncStatus.ERROR, lastError: error.message || "Erro ao carregar CODE Imob." });
    }
  };

  const login = async (credentials) => {
    runtimeState.syncStatus = SyncStatus.CONNECTING;
    runtimeState.lastError = "";
    try {
      const session = await CodeImobProvider.login(credentials);
      setState({ authSession: session, syncStatus: SyncStatus.ONLINE });
      return refreshFromCodeImob();
    } catch (error) {
      return setState({ authSession: null, syncStatus: SyncStatus.ERROR, lastError: error.message || "Falha na autenticação CODE Imob." });
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

  const appendHistoryFromChat = async (clientId, chat) => {
    const messages = (chat.messages || []).slice(-2);
    if (!clientId || !messages.length) return getState();
    const event = addRuntimeEvent("whatsapp_history_captured", { clientId, messages, waKey: chat.waKey || chat.key });
    try { await CodeImobProvider.appendHistory({ clientId, messages, waKey: chat.waKey || chat.key }); event.syncStatus = "synced"; } catch (error) { event.syncStatus = "failed"; runtimeState.lastError = error.message; }
    return getState();
  };

  const addChatToPipeline = async ({ chat, funnelId, stageId }) => {
    const telefone = normalizePhone(chat.telefone || chat.phone);
    const nome = clean(chat.nome || chat.name);
    const event = addRuntimeEvent("opportunity_add_requested", { telefone, nome, funnelId, stageId, waKey: chat.waKey || chat.key });
    try {
      let client = telefone ? await CodeImobProvider.findClientByPhone(telefone) : null;
      if (!client) client = await CodeImobProvider.createClient({ nome, telefone, waKey: chat.waKey || chat.key });
      let opportunity = await CodeImobProvider.findActiveOpportunity(client.id, funnelId);
      if (!opportunity) opportunity = await CodeImobProvider.createOpportunity({ clientId: client.id, funnelId, stageId });
      await CodeImobProvider.appendHistory({ clientId: client.id, messages: (chat.messages || []).slice(-2), waKey: chat.waKey || chat.key });
      event.syncStatus = "synced";
      await refreshFromCodeImob();
    } catch (error) {
      event.syncStatus = "failed";
      runtimeState.lastError = error.message || "Não foi possível atualizar CODE Imob.";
    }
    return getState();
  };

  const moveOpportunity = async (opportunityId, stageId) => {
    const event = addRuntimeEvent("opportunity_stage_move_requested", { opportunityId, stageId });
    try { await CodeImobProvider.moveOpportunity({ opportunityId, stageId }); event.syncStatus = "synced"; await refreshFromCodeImob(); } catch (error) { event.syncStatus = "failed"; runtimeState.lastError = error.message; }
    return getState();
  };

  const deleteOpportunity = async (opportunityId) => {
    const event = addRuntimeEvent("opportunity_delete_requested", { opportunityId });
    try { await CodeImobProvider.deleteOpportunity({ opportunityId }); event.syncStatus = "synced"; await refreshFromCodeImob(); } catch (error) { event.syncStatus = "failed"; runtimeState.lastError = error.message; }
    return getState();
  };

  window.CodeImobProvider = CodeImobProvider;
  window.CodeSyncProvider = CodeImobProvider;
  window.CodeWhatsStorage = { SyncStatus, getState, saveState, login, logout, refreshFromCodeImob, saveDetectedChats, addChatToPipeline, appendHistoryFromChat, moveOpportunity, deleteOpportunity };
})();


