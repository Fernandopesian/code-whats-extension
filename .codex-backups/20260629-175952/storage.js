(function () {
  const STORAGE_KEY = "codeWhatsLocalState";
  const CURRENT_VERSION = 6;

  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalizePhone = (value) => clean(value).replace(/\D/g, "");

  const defaultEtapas = () => [
    { id: uid("etapa"), nome: "Em atendimento" },
    { id: uid("etapa"), nome: "Follow-up" },
    { id: uid("etapa"), nome: "Fechado" }
  ];

  const sampleState = () => {
    const funis = ["Clientes", "Parceiros", "Construtoras", "Pos-venda"].map((nome) => ({ id: uid("funil"), nome, etapas: defaultEtapas() }));
    return {
      version: CURRENT_VERSION,
      activeFunnelId: funis[0].id,
      activeView: "clients",
      drawerOpen: true,
      createdAt: now(),
      funis,
      clientes: [],
      notas: [],
      lembretes: [],
      fixados: [],
      templates: [],
      detectedChats: [],
      tags: ["WhatsApp", "Lead"]
    };
  };

  const withFunnelAliases = (funil) => ({
    ...funil,
    name: funil.nome,
    columns: funil.etapas.map((etapa) => ({ ...etapa, name: etapa.nome }))
  });

  const withClientAliases = (cliente) => ({
    ...cliente,
    name: cliente.nome,
    phone: cliente.telefone,
    funnelId: cliente.funilId,
    columnId: cliente.etapaId,
    note: cliente.observacao,
    value: cliente.valor,
    temperature: cliente.temperatura,
    nextAction: cliente.proximaAcao,
    lastMessage: cliente.ultimaMensagem,
    lastMessageTime: cliente.ultimoContato,
    chatTitle: cliente.nome,
    pinned: false
  });

  const decorateState = (state) => {
    state.funnels = state.funis.map(withFunnelAliases);
    state.clients = state.clientes.map((cliente) => withClientAliases({ ...cliente, pinned: state.fixados.includes(cliente.id) }));
    state.pinnedClientIds = state.fixados;
    return state;
  };

  const normalizeEtapa = (etapa) => ({ id: etapa.id || uid("etapa"), nome: clean(etapa.nome || etapa.name) || "Etapa" });

  const normalizeFunil = (funil) => ({
    id: funil.id || uid("funil"),
    nome: clean(funil.nome || funil.name) || "Funil sem nome",
    etapas: asArray(funil.etapas || funil.columns).length ? asArray(funil.etapas || funil.columns).map(normalizeEtapa) : defaultEtapas()
  });

  const normalizeDetectedChat = (chat) => ({
    key: clean(chat.key || chat.waKey) || uid("chat"),
    waKey: clean(chat.waKey || chat.key) || uid("chat"),
    nome: clean(chat.nome || chat.name || chat.chatTitle) || "Conversa sem nome",
    name: clean(chat.nome || chat.name || chat.chatTitle) || "Conversa sem nome",
    chatTitle: clean(chat.chatTitle || chat.nome || chat.name) || "Conversa sem nome",
    telefone: normalizePhone(chat.telefone || chat.phone),
    phone: normalizePhone(chat.telefone || chat.phone),
    foto: clean(chat.foto || chat.photo),
    photo: clean(chat.foto || chat.photo),
    ultimaMensagem: clean(chat.ultimaMensagem || chat.lastMessage),
    lastMessage: clean(chat.ultimaMensagem || chat.lastMessage),
    ultimoContato: clean(chat.ultimoContato || chat.lastMessageTime),
    lastMessageTime: clean(chat.ultimoContato || chat.lastMessageTime),
    unread: clean(chat.unread),
    capturedAt: chat.capturedAt || now()
  });

  const normalizeCliente = (cliente, state) => {
    const funil = state.funis.find((item) => item.id === (cliente.funilId || cliente.funnelId)) || state.funis[0];
    const etapaId = cliente.etapaId || cliente.columnId;
    const etapa = funil && funil.etapas.find((item) => item.id === etapaId);
    const telefone = normalizePhone(cliente.telefone || cliente.phone);
    const nome = clean(cliente.nome || cliente.name || cliente.chatTitle) || "Contato sem nome";
    const tags = asArray(cliente.tags).length ? asArray(cliente.tags).map(clean).filter(Boolean) : [clean(cliente.etiqueta || cliente.label)].filter(Boolean);
    return {
      id: cliente.id || uid("cliente"),
      waKey: clean(cliente.waKey) || telefone || nome,
      nome,
      telefone,
      funilId: funil ? funil.id : "",
      etapaId: etapa ? etapa.id : (funil && funil.etapas[0] ? funil.etapas[0].id : ""),
      tags,
      temperatura: ["frio", "morno", "quente"].includes(cliente.temperatura || cliente.temperature) ? (cliente.temperatura || cliente.temperature) : "morno",
      valor: Number(cliente.valor || cliente.value) || 0,
      observacao: clean(cliente.observacao || cliente.note),
      ultimaMensagem: clean(cliente.ultimaMensagem || cliente.lastMessage || (cliente.captured && cliente.captured.lastMessage)),
      ultimoContato: clean(cliente.ultimoContato || cliente.lastMessageTime || (cliente.captured && cliente.captured.lastMessageTime)),
      proximaAcao: clean(cliente.proximaAcao || cliente.nextAction),
      origem: ["whatsapp", "csv", "manual"].includes(cliente.origem) ? cliente.origem : (cliente.captured ? "whatsapp" : "manual"),
      foto: clean(cliente.foto || cliente.photo),
      captured: cliente.captured && typeof cliente.captured === "object" ? cliente.captured : {},
      createdAt: cliente.createdAt || now(),
      updatedAt: cliente.updatedAt || now()
    };
  };

  const normalizeNote = (note) => ({ id: note.id || uid("nota"), clienteId: note.clienteId || note.clientId || "", text: clean(note.text || note.texto), createdAt: note.createdAt || now() });
  const normalizeReminder = (reminder) => ({ id: reminder.id || uid("lembrete"), clienteId: reminder.clienteId || reminder.clientId || "", title: clean(reminder.title || reminder.titulo || reminder.text) || "Lembrete", dueAt: clean(reminder.dueAt), note: clean(reminder.note || reminder.observacao), done: Boolean(reminder.done), createdAt: reminder.createdAt || now() });
  const normalizeTemplate = (template) => ({ id: template.id || uid("template"), titulo: clean(template.titulo || template.title) || "Mensagem", texto: clean(template.texto || template.text), createdAt: template.createdAt || now(), updatedAt: template.updatedAt || now() });

  const normalizeState = (input) => {
    if (!input || !(Array.isArray(input.funis) || Array.isArray(input.funnels))) return sampleState();
    const state = {
      version: CURRENT_VERSION,
      activeFunnelId: input.activeFunnelId || input.activeFunilId || (input.funis && input.funis[0] && input.funis[0].id) || (input.funnels && input.funnels[0] && input.funnels[0].id),
      activeView: input.activeView || "clients",
      drawerOpen: input.drawerOpen !== false,
      createdAt: input.createdAt || now(),
      funis: asArray(input.funis || input.funnels).map(normalizeFunil),
      clientes: [],
      notas: asArray(input.notas || []).map(normalizeNote).filter((note) => note.text),
      lembretes: asArray(input.lembretes || []).map(normalizeReminder),
      fixados: asArray(input.fixados || input.pinnedClientIds),
      templates: asArray(input.templates).map(normalizeTemplate).filter((template) => template.texto),
      detectedChats: asArray(input.detectedChats).map(normalizeDetectedChat),
      tags: asArray(input.tags).map(clean).filter(Boolean)
    };
    if (!state.funis.length) state.funis = sampleState().funis;
    if (!state.funis.some((funil) => funil.id === state.activeFunnelId)) state.activeFunnelId = state.funis[0].id;
    state.clientes = asArray(input.clientes || input.clients).map((cliente) => normalizeCliente(cliente, state));
    state.fixados = Array.from(new Set(state.fixados)).filter((id) => state.clientes.some((cliente) => cliente.id === id));
    state.tags = Array.from(new Set([...state.tags, ...state.clientes.flatMap((cliente) => cliente.tags), "WhatsApp", "Lead"].map(clean).filter(Boolean)));
    return decorateState(state);
  };

  const readRaw = () => new Promise((resolve) => chrome.storage.local.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY])));
  const writeRaw = (state) => new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: normalizeState(state) }, resolve));
  const getState = async () => { const state = normalizeState(await readRaw()); await writeRaw(state); return state; };
  const saveState = async (nextState) => { const state = normalizeState(nextState); await writeRaw(state); return state; };
  const updateState = async (updater) => { const current = await getState(); return saveState(updater(clone(current)) || current); };

  const createFunnel = (name) => updateState((state) => { const funil = { id: uid("funil"), nome: clean(name) || "Novo funil", etapas: defaultEtapas() }; state.funis.push(funil); state.activeFunnelId = funil.id; return state; });
  const renameFunnel = (funilId, nome) => updateState((state) => { const funil = state.funis.find((item) => item.id === funilId); if (funil && clean(nome)) funil.nome = clean(nome); return state; });
  const deleteFunnel = (funilId) => updateState((state) => { if (state.funis.length <= 1) return state; state.funis = state.funis.filter((funil) => funil.id !== funilId); const fallback = state.funis[0]; state.clientes.forEach((cliente) => { if (cliente.funilId === funilId) { cliente.funilId = fallback.id; cliente.etapaId = fallback.etapas[0].id; } }); if (state.activeFunnelId === funilId) state.activeFunnelId = fallback.id; return state; });
  const createColumn = (funilId, name) => updateState((state) => { const funil = state.funis.find((item) => item.id === funilId); if (funil) funil.etapas.push({ id: uid("etapa"), nome: clean(name) || "Nova etapa" }); return state; });
  const renameColumn = (funilId, etapaId, name) => updateState((state) => { const funil = state.funis.find((item) => item.id === funilId); const etapa = funil && funil.etapas.find((item) => item.id === etapaId); if (etapa && clean(name)) etapa.nome = clean(name); return state; });
  const deleteColumn = (funilId, etapaId) => updateState((state) => { const funil = state.funis.find((item) => item.id === funilId); if (!funil || funil.etapas.length <= 1) return state; const fallback = funil.etapas.find((etapa) => etapa.id !== etapaId); funil.etapas = funil.etapas.filter((etapa) => etapa.id !== etapaId); state.clientes.forEach((cliente) => { if (cliente.funilId === funilId && cliente.etapaId === etapaId) cliente.etapaId = fallback.id; }); return state; });

  const upsertClient = (cliente) => updateState((state) => { const stamp = now(); const normalizedIncoming = normalizeCliente(cliente, state); const index = state.clientes.findIndex((item) => (cliente.id && item.id === cliente.id) || (normalizedIncoming.telefone && item.telefone === normalizedIncoming.telefone) || (normalizedIncoming.waKey && item.waKey === normalizedIncoming.waKey)); const previous = index >= 0 ? state.clientes[index] : {}; const merged = normalizeCliente({ ...previous, ...normalizedIncoming, updatedAt: stamp, createdAt: previous.createdAt || normalizedIncoming.createdAt || stamp }, state); if (index >= 0) state.clientes[index] = merged; else state.clientes.push(merged); return state; });
  const deleteClient = (clienteId) => updateState((state) => { state.clientes = state.clientes.filter((cliente) => cliente.id !== clienteId); state.fixados = state.fixados.filter((id) => id !== clienteId); state.notas = state.notas.filter((nota) => nota.clienteId !== clienteId); state.lembretes = state.lembretes.filter((lembrete) => lembrete.clienteId !== clienteId); return state; });
  const moveClient = (clienteId, etapaId) => updateState((state) => { const cliente = state.clientes.find((item) => item.id === clienteId); if (cliente) { cliente.etapaId = etapaId; cliente.updatedAt = now(); } return state; });
  const addNote = (clienteId, text) => updateState((state) => { if (clean(text)) state.notas.unshift({ id: uid("nota"), clienteId, text: clean(text), createdAt: now() }); return state; });
  const addReminder = (clienteId, reminder) => updateState((state) => { const title = clean(reminder && (reminder.title || reminder.text)); if (title) state.lembretes.unshift({ id: uid("lembrete"), clienteId, title, dueAt: clean(reminder.dueAt), note: clean(reminder.note), done: false, createdAt: now() }); return state; });
  const togglePinned = (clienteId) => updateState((state) => { state.fixados = state.fixados.includes(clienteId) ? state.fixados.filter((id) => id !== clienteId) : [...state.fixados, clienteId]; return state; });
  const saveDetectedChats = (detectedChats) => updateState((state) => { state.detectedChats = asArray(detectedChats).map(normalizeDetectedChat).slice(0, 80); return state; });
  const upsertTemplate = (template) => updateState((state) => { const stamp = now(); const payload = normalizeTemplate({ ...template, updatedAt: stamp }); const index = state.templates.findIndex((item) => item.id === payload.id); if (index >= 0) state.templates[index] = payload; else state.templates.push(payload); return state; });
  const deleteTemplate = (templateId) => updateState((state) => { state.templates = state.templates.filter((template) => template.id !== templateId); return state; });
  const importState = async (incoming) => { const state = normalizeState(incoming); await writeRaw(state); return state; };

  window.CodeWhatsStorage = { STORAGE_KEY, uid, getState, saveState, updateState, createFunnel, renameFunnel, deleteFunnel, createColumn, renameColumn, deleteColumn, upsertClient, deleteClient, moveClient, addNote, addReminder, togglePinned, saveDetectedChats, upsertTemplate, deleteTemplate, importState };
})();

