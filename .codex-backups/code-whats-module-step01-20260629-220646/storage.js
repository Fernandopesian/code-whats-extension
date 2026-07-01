(function () {
  const STORAGE_KEY = "codeWhatsLocalState";
  const CURRENT_VERSION = 8;
  const SyncStatus = Object.freeze({ OFFLINE: "offline", CONNECTING: "connecting", ONLINE: "online", ERROR: "error" });

  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalizePhone = (value) => clean(value).replace(/\D/g, "");

  // Futuro CODE Imob/Supabase: este cache sera preenchido por CodeSyncProvider.loadFunnels().
  // Auth/RLS: funis e etapas devem respeitar usuario, imobiliaria e permissoes no Supabase.
  const defaultCodeFunnelsCache = () => [{
    id: "code_pipeline_default",
    nome: "Pipeline CODE Imob",
    etapas: [
      { id: "code_stage_inbox", nome: "Em atendimento" },
      { id: "code_stage_followup", nome: "Follow-up" },
      { id: "code_stage_closed", nome: "Fechado" }
    ]
  }];

  const sampleState = () => {
    const funis = defaultCodeFunnelsCache();
    return {
      version: CURRENT_VERSION,
      activeFunnelId: funis[0].id,
      activeView: "clients",
      drawerOpen: true,
      createdAt: now(),
      syncStatus: SyncStatus.OFFLINE,
      authSession: null,
      funis,
      clientes: [],
      notas: [],
      lembretes: [],
      fixados: [],
      templates: [],
      detectedChats: [],
      leads: [],
      syncEvents: [],
      tags: []
    };
  };

  const withFunnelAliases = (funil) => ({ ...funil, name: funil.nome, columns: funil.etapas.map((etapa) => ({ ...etapa, name: etapa.nome })) });
  const withClientAliases = (cliente, state) => ({ ...cliente, name: cliente.nome, phone: cliente.telefone, funnelId: cliente.funilId, columnId: cliente.etapaId, note: cliente.observacao, value: cliente.valor, temperature: cliente.temperatura, nextAction: cliente.proximaAcao, lastMessage: cliente.ultimaMensagem, lastMessageTime: cliente.ultimoContato, chatTitle: cliente.nome, pinned: state.fixados.includes(cliente.id) });
  const decorateState = (state) => { state.funnels = state.funis.map(withFunnelAliases); state.clients = state.clientes.map((cliente) => withClientAliases(cliente, state)); state.pinnedClientIds = state.fixados; return state; };

  const normalizeEtapa = (etapa) => ({ id: etapa.id || uid("etapa"), nome: clean(etapa.nome || etapa.name) || "Etapa" });
  const normalizeFunil = (funil) => ({ id: funil.id || uid("funil"), nome: clean(funil.nome || funil.name) || "Funil CODE Imob", etapas: asArray(funil.etapas || funil.columns).length ? asArray(funil.etapas || funil.columns).map(normalizeEtapa) : defaultCodeFunnelsCache()[0].etapas });
  const normalizeDetectedChat = (chat) => ({ key: clean(chat.key || chat.waKey) || uid("chat"), waKey: clean(chat.waKey || chat.key) || uid("chat"), nome: clean(chat.nome || chat.name || chat.chatTitle) || "Conversa sem nome", name: clean(chat.nome || chat.name || chat.chatTitle) || "Conversa sem nome", chatTitle: clean(chat.chatTitle || chat.nome || chat.name) || "Conversa sem nome", telefone: normalizePhone(chat.telefone || chat.phone), phone: normalizePhone(chat.telefone || chat.phone), foto: clean(chat.foto || chat.photo), photo: clean(chat.foto || chat.photo), ultimaMensagem: clean(chat.ultimaMensagem || chat.lastMessage), lastMessage: clean(chat.ultimaMensagem || chat.lastMessage), ultimoContato: clean(chat.ultimoContato || chat.lastMessageTime), lastMessageTime: clean(chat.ultimoContato || chat.lastMessageTime), unread: clean(chat.unread), capturedAt: chat.capturedAt || now() });
  const normalizeLead = (lead) => ({ id: lead.id || uid("lead"), nome: clean(lead.nome || lead.name), telefone: normalizePhone(lead.telefone || lead.phone), email: clean(lead.email), cidade: clean(lead.cidade), origem: clean(lead.origem), campanha: clean(lead.campanha), formulario: clean(lead.formulario), camposExtras: lead.camposExtras && typeof lead.camposExtras === "object" ? lead.camposExtras : {}, status: clean(lead.status) || "pendente", createdAt: lead.createdAt || now(), updatedAt: lead.updatedAt || lead.createdAt || now() });
  const normalizeEvent = (event) => ({ id: event.id || uid("event"), type: clean(event.type), userId: clean(event.userId), contactId: clean(event.contactId), leadId: clean(event.leadId), payload: event.payload && typeof event.payload === "object" ? event.payload : {}, createdAt: event.createdAt || now(), syncStatus: ["pending", "synced", "failed"].includes(event.syncStatus) ? event.syncStatus : "pending" });
  const normalizeNote = (note) => ({ id: note.id || uid("nota"), clienteId: note.clienteId || note.clientId || "", text: clean(note.text || note.texto), createdAt: note.createdAt || now() });
  const normalizeReminder = (reminder) => ({ id: reminder.id || uid("lembrete"), clienteId: reminder.clienteId || reminder.clientId || "", title: clean(reminder.title || reminder.titulo || reminder.text) || "Lembrete", dueAt: clean(reminder.dueAt), note: clean(reminder.note || reminder.observacao), done: Boolean(reminder.done), createdAt: reminder.createdAt || now() });
  const normalizeTemplate = (template) => ({ id: template.id || uid("template"), titulo: clean(template.titulo || template.title) || "Mensagem", texto: clean(template.texto || template.text), createdAt: template.createdAt || now(), updatedAt: template.updatedAt || now() });

  const normalizeCliente = (cliente, state) => {
    const funil = state.funis.find((item) => item.id === (cliente.funilId || cliente.funnelId)) || state.funis[0];
    const etapaId = cliente.etapaId || cliente.columnId;
    const etapa = funil && funil.etapas.find((item) => item.id === etapaId);
    const telefone = normalizePhone(cliente.telefone || cliente.phone);
    const nome = clean(cliente.nome || cliente.name || cliente.chatTitle) || "Contato sem nome";
    const tags = asArray(cliente.tags).length ? asArray(cliente.tags).map(clean).filter(Boolean) : [clean(cliente.etiqueta || cliente.label)].filter(Boolean);
    return { id: cliente.id || uid("cliente"), waKey: clean(cliente.waKey) || telefone || nome, nome, telefone, funilId: funil ? funil.id : "", etapaId: etapa ? etapa.id : (funil && funil.etapas[0] ? funil.etapas[0].id : ""), tags, temperatura: ["frio", "morno", "quente"].includes(cliente.temperatura || cliente.temperature) ? (cliente.temperatura || cliente.temperature) : "morno", valor: Number(cliente.valor || cliente.value) || 0, observacao: clean(cliente.observacao || cliente.note), ultimaMensagem: clean(cliente.ultimaMensagem || cliente.lastMessage || (cliente.captured && cliente.captured.lastMessage)), ultimoContato: clean(cliente.ultimoContato || cliente.lastMessageTime || (cliente.captured && cliente.captured.lastMessageTime)), proximaAcao: clean(cliente.proximaAcao || cliente.nextAction), origem: ["whatsapp", "csv", "manual", "code"].includes(cliente.origem) ? cliente.origem : "code", foto: clean(cliente.foto || cliente.photo), captured: cliente.captured && typeof cliente.captured === "object" ? cliente.captured : {}, createdAt: cliente.createdAt || now(), updatedAt: cliente.updatedAt || now() };
  };

  const normalizeState = (input) => {
    if (!input || !(Array.isArray(input.funis) || Array.isArray(input.funnels))) return sampleState();
    const funis = asArray(input.funis || input.funnels).map(normalizeFunil);
    const state = { version: CURRENT_VERSION, activeFunnelId: input.activeFunnelId || input.activeFunilId || (funis[0] && funis[0].id), activeView: input.activeView || "clients", drawerOpen: input.drawerOpen !== false, createdAt: input.createdAt || now(), syncStatus: Object.values(SyncStatus).includes(input.syncStatus) ? input.syncStatus : SyncStatus.OFFLINE, authSession: input.authSession || null, funis: funis.length ? funis : defaultCodeFunnelsCache(), clientes: [], notas: asArray(input.notas).map(normalizeNote).filter((note) => note.text), lembretes: asArray(input.lembretes).map(normalizeReminder), fixados: asArray(input.fixados || input.pinnedClientIds), templates: asArray(input.templates).map(normalizeTemplate).filter((template) => template.texto), detectedChats: asArray(input.detectedChats).map(normalizeDetectedChat), leads: asArray(input.leads).map(normalizeLead), syncEvents: asArray(input.syncEvents).map(normalizeEvent), tags: asArray(input.tags).map(clean).filter(Boolean) };
    if (!state.funis.some((funil) => funil.id === state.activeFunnelId)) state.activeFunnelId = state.funis[0].id;
    state.clientes = asArray(input.clientes || input.clients).map((cliente) => normalizeCliente(cliente, state));
    state.fixados = Array.from(new Set(state.fixados)).filter((id) => state.clientes.some((cliente) => cliente.id === id));
    state.tags = Array.from(new Set([...state.tags, ...state.clientes.flatMap((cliente) => cliente.tags)].map(clean).filter(Boolean)));
    return decorateState(state);
  };

  const readRaw = () => new Promise((resolve) => chrome.storage.local.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY])));
  const writeRaw = (state) => new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: normalizeState(state) }, resolve));
  const getState = async () => { const state = normalizeState(await readRaw()); await writeRaw(state); return state; };
  const saveState = async (nextState) => { const state = normalizeState(nextState); await writeRaw(state); return state; };
  const updateState = async (updater) => { const current = await getState(); return saveState(updater(clone(current)) || current); };

  // Futuro Supabase Auth: login/logout devem delegar para Supabase Auth e persistir apenas uma sessao segura.
  // Futuro Realtime: loadFunnels/loadClients/loadTemplates/loadTags deverao assinar mudancas em tempo real.
  // Futuro Storage: anexos e midias devem usar buckets privados com policies por imobiliaria.
  // Futuro Edge Functions: pushEvent devera enviar acoes para uma funcao server-side, validando regras de negocio.
  // Futuro RLS: todas as leituras/escritas precisam ser protegidas por policies no Supabase.
  const CodeSyncProvider = {
    login: () => Promise.resolve(null),
    logout: () => Promise.resolve(),
    loadFunnels: () => Promise.resolve([]),
    loadClients: () => Promise.resolve([]),
    loadTemplates: () => Promise.resolve([]),
    loadTags: () => Promise.resolve([]),
    pushEvent: (event) => Promise.resolve(event)
  };

  const queueEventOnState = (state, type, data = {}) => {
    if (!Array.isArray(state.syncEvents)) state.syncEvents = [];
    const auth = state.authSession || {};
    const event = normalizeEvent({ type, userId: auth.userId, contactId: data.contactId, leadId: data.leadId, payload: data.payload || {}, syncStatus: "pending" });
    state.syncEvents.unshift(event);
    return event;
  };

  const addSyncEvent = async (event) => {
    let queued = null;
    const state = await updateState((draft) => { queued = queueEventOnState(draft, event.type, event); return draft; });
    await CodeSyncProvider.pushEvent(queued);
    return state;
  };

  const setSyncStatus = (syncStatus) => updateState((state) => { state.syncStatus = Object.values(SyncStatus).includes(syncStatus) ? syncStatus : SyncStatus.OFFLINE; return state; });
  const connectCode = async () => { await CodeSyncProvider.login(); return setSyncStatus(SyncStatus.OFFLINE); };
  const disconnectCode = async () => { await CodeSyncProvider.logout(); return updateState((state) => { state.authSession = null; state.syncStatus = SyncStatus.OFFLINE; return state; }); };
  const pushPendingEvents = async () => { const state = await getState(); await Promise.all(state.syncEvents.filter((event) => event.syncStatus === "pending").map((event) => CodeSyncProvider.pushEvent(event))); return state; };

  // Funis/etapas nao sao criados pela extensao. Futuro: usar CodeSyncProvider.loadFunnels().
  // const createFunnel = async () => CodeSyncProvider.pushEvent({ type: "funnel_create_requested" });
  // const renameFunnel = async () => CodeSyncProvider.pushEvent({ type: "funnel_rename_requested" });
  // const deleteFunnel = async () => CodeSyncProvider.pushEvent({ type: "funnel_delete_requested" });
  // const createStage = async () => CodeSyncProvider.pushEvent({ type: "stage_create_requested" });
  // const deleteStage = async () => CodeSyncProvider.pushEvent({ type: "stage_delete_requested" });

  const upsertClient = (cliente) => updateState((state) => { const stamp = now(); const normalizedIncoming = normalizeCliente(cliente, state); const index = state.clientes.findIndex((item) => (cliente.id && item.id === cliente.id) || (normalizedIncoming.telefone && item.telefone === normalizedIncoming.telefone) || (normalizedIncoming.waKey && item.waKey === normalizedIncoming.waKey)); const previous = index >= 0 ? state.clientes[index] : {}; const merged = normalizeCliente({ ...previous, ...normalizedIncoming, updatedAt: stamp, createdAt: previous.createdAt || normalizedIncoming.createdAt || stamp }, state); if (index >= 0) state.clientes[index] = merged; else state.clientes.push(merged); queueEventOnState(state, "client_upsert_requested", { contactId: merged.id, payload: merged }); return state; });
  const deleteClient = (clienteId) => updateState((state) => { queueEventOnState(state, "client_delete_requested", { contactId: clienteId }); return state; });
  const moveClient = (clienteId, etapaId) => updateState((state) => { const cliente = state.clientes.find((item) => item.id === clienteId); if (cliente) queueEventOnState(state, "client_moved_stage", { contactId: cliente.id, payload: { fromEtapaId: cliente.etapaId, toEtapaId: etapaId, funilId: cliente.funilId } }); return state; });
  const addNote = (clienteId, text) => updateState((state) => { if (clean(text)) { const nota = { id: uid("nota"), clienteId, text: clean(text), createdAt: now() }; state.notas.unshift(nota); queueEventOnState(state, "note_created", { contactId: clienteId, payload: nota }); } return state; });
  const addReminder = (clienteId, reminder) => updateState((state) => { const title = clean(reminder && (reminder.title || reminder.text)); if (title) { const lembrete = { id: uid("lembrete"), clienteId, title, dueAt: clean(reminder.dueAt), note: clean(reminder.note), done: false, createdAt: now() }; state.lembretes.unshift(lembrete); queueEventOnState(state, "reminder_created", { contactId: clienteId, payload: lembrete }); } return state; });
  const togglePinned = (clienteId) => updateState((state) => { state.fixados = state.fixados.includes(clienteId) ? state.fixados.filter((id) => id !== clienteId) : [...state.fixados, clienteId]; queueEventOnState(state, "local_pin_toggled", { contactId: clienteId, payload: { pinned: state.fixados.includes(clienteId) } }); return state; });
  const saveDetectedChats = (detectedChats) => updateState((state) => { state.detectedChats = asArray(detectedChats).map(normalizeDetectedChat).slice(0, 80); if (state.detectedChats.length) queueEventOnState(state, "whatsapp_message_captured", { payload: { visibleChats: state.detectedChats.length } }); return state; });
  const upsertTemplate = (template) => updateState((state) => { const stamp = now(); const payload = normalizeTemplate({ ...template, updatedAt: stamp }); const index = state.templates.findIndex((item) => item.id === payload.id); if (index >= 0) state.templates[index] = payload; else state.templates.push(payload); queueEventOnState(state, "template_upsert_requested", { payload }); return state; });
  const deleteTemplate = (templateId) => updateState((state) => { queueEventOnState(state, "template_delete_requested", { payload: { templateId } }); return state; });
  const updateLead = (leadId, patch) => updateState((state) => { const lead = state.leads.find((item) => item.id === leadId); if (lead) { Object.assign(lead, patch, { updatedAt: now() }); queueEventOnState(state, "lead_update_requested", { leadId, payload: { patch } }); } return state; });
  const importState = async (incoming) => { const state = normalizeState(incoming); await writeRaw(state); return state; };

  window.CodeSyncProvider = CodeSyncProvider;
  window.CodeWhatsStorage = { STORAGE_KEY, SyncStatus, uid, getState, saveState, updateState, setSyncStatus, connectCode, disconnectCode, pushPendingEvents, addSyncEvent, upsertClient, deleteClient, moveClient, addNote, addReminder, togglePinned, saveDetectedChats, upsertTemplate, deleteTemplate, updateLead, importState };
})();
