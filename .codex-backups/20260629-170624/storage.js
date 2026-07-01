(function () {
  const STORAGE_KEY = "codeWhatsLocalState";
  const CURRENT_VERSION = 5;

  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => new Date().toISOString();
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const phoneKey = (value) => clean(value).replace(/\D/g, "");

  const defaultColumns = () => [
    { id: uid("column"), name: "Em atendimento" },
    { id: uid("column"), name: "Follow-up" },
    { id: uid("column"), name: "Fechado" }
  ];

  const sampleState = () => {
    const funnels = ["Clientes", "Parceiros", "Construtoras", "Pos-venda"].map((name) => ({
      id: uid("funnel"),
      name,
      columns: defaultColumns()
    }));
    return {
      version: CURRENT_VERSION,
      activeFunnelId: funnels[0].id,
      activeView: "kanban",
      drawerOpen: true,
      createdAt: now(),
      funnels,
      clients: [],
      pinnedClientIds: [],
      tags: ["WhatsApp", "Lead"],
      detectedChats: []
    };
  };

  const normalizeFunnel = (funnel) => ({
    id: funnel && funnel.id ? funnel.id : uid("funnel"),
    name: clean(funnel && funnel.name) || "Funil sem nome",
    columns: asArray(funnel && funnel.columns).length
      ? funnel.columns.map((column) => ({ id: column.id || uid("column"), name: clean(column.name) || "Etapa" }))
      : defaultColumns()
  });

  const normalizeNote = (note) => ({ id: note.id || uid("note"), text: clean(note.text), createdAt: note.createdAt || now() });

  const normalizeReminder = (reminder) => ({
    id: reminder.id || uid("reminder"),
    title: clean(reminder.title || reminder.text) || "Lembrete",
    dueAt: clean(reminder.dueAt),
    note: clean(reminder.note),
    done: Boolean(reminder.done),
    createdAt: reminder.createdAt || now()
  });

  const normalizeDetectedChat = (chat) => ({
    key: clean(chat.key || chat.waKey) || uid("chat"),
    waKey: clean(chat.waKey || chat.key) || uid("chat"),
    name: clean(chat.name || chat.chatTitle) || "Conversa sem nome",
    chatTitle: clean(chat.chatTitle || chat.name) || "Conversa sem nome",
    phone: clean(chat.phone),
    photo: clean(chat.photo),
    lastMessage: clean(chat.lastMessage),
    lastMessageTime: clean(chat.lastMessageTime),
    unread: clean(chat.unread),
    capturedAt: chat.capturedAt || now()
  });

  const normalizeClient = (client, state) => {
    const fallbackFunnel = state.funnels[0];
    const funnel = state.funnels.find((item) => item.id === client.funnelId) || fallbackFunnel;
    const firstColumnId = funnel && funnel.columns[0] ? funnel.columns[0].id : "";
    const columnExists = funnel && funnel.columns.some((column) => column.id === client.columnId);
    const tags = asArray(client.tags).length ? asArray(client.tags).map(clean).filter(Boolean) : [clean(client.label)].filter(Boolean);

    return {
      id: client.id || uid("client"),
      funnelId: funnel ? funnel.id : "",
      columnId: columnExists ? client.columnId : firstColumnId,
      name: clean(client.name) || clean(client.chatTitle) || "Contato sem nome",
      phone: clean(client.phone),
      chatTitle: clean(client.chatTitle) || clean(client.name),
      photo: clean(client.photo),
      about: clean(client.about),
      waKey: clean(client.waKey) || phoneKey(client.phone) || clean(client.chatTitle) || clean(client.name) || uid("wa"),
      label: clean(client.label || tags[0]),
      tags,
      temperature: ["frio", "morno", "quente"].includes(client.temperature) ? client.temperature : "morno",
      value: Number(client.value) || 0,
      note: clean(client.note),
      nextAction: clean(client.nextAction),
      lastMessage: clean(client.lastMessage || (client.captured && client.captured.lastMessage)),
      lastMessageTime: clean(client.lastMessageTime || (client.captured && client.captured.lastMessageTime)),
      pinned: Boolean(client.pinned),
      notes: asArray(client.notes).map(normalizeNote).filter((note) => note.text),
      reminders: asArray(client.reminders).map(normalizeReminder),
      captured: client.captured && typeof client.captured === "object" ? client.captured : {},
      createdAt: client.createdAt || now(),
      updatedAt: client.updatedAt || now()
    };
  };

  const normalizeState = (input) => {
    if (!input || !Array.isArray(input.funnels) || !input.funnels.length) return sampleState();
    const state = {
      version: CURRENT_VERSION,
      activeFunnelId: input.activeFunnelId || input.funnels[0].id,
      activeView: input.activeView || "kanban",
      drawerOpen: input.drawerOpen !== false,
      createdAt: input.createdAt || now(),
      funnels: input.funnels.map(normalizeFunnel),
      clients: [],
      pinnedClientIds: asArray(input.pinnedClientIds),
      tags: asArray(input.tags).map(clean).filter(Boolean),
      detectedChats: asArray(input.detectedChats).map(normalizeDetectedChat)
    };
    if (!state.funnels.some((funnel) => funnel.id === state.activeFunnelId)) state.activeFunnelId = state.funnels[0].id;
    state.clients = asArray(input.clients).map((client) => normalizeClient(client, state));
    state.pinnedClientIds = Array.from(new Set([...state.pinnedClientIds, ...state.clients.filter((client) => client.pinned).map((client) => client.id)])).filter((id) => state.clients.some((client) => client.id === id));
    state.clients.forEach((client) => { client.pinned = state.pinnedClientIds.includes(client.id); });
    state.tags = Array.from(new Set([...state.tags, ...state.clients.flatMap((client) => client.tags), "WhatsApp", "Lead"].map(clean).filter(Boolean)));
    return state;
  };

  const readRaw = () => new Promise((resolve) => chrome.storage.local.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY])));
  const writeRaw = (state) => new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve));

  const getState = async () => { const state = normalizeState(await readRaw()); await writeRaw(state); return state; };
  const saveState = async (nextState) => { const state = normalizeState(nextState); await writeRaw(state); return state; };
  const updateState = async (updater) => { const current = await getState(); return saveState(updater(clone(current)) || current); };

  const createFunnel = (name) => updateState((state) => { const funnel = { id: uid("funnel"), name: clean(name) || "Novo funil", columns: defaultColumns() }; state.funnels.push(funnel); state.activeFunnelId = funnel.id; return state; });
  const createColumn = (funnelId, name) => updateState((state) => { const funnel = state.funnels.find((item) => item.id === funnelId); if (funnel) funnel.columns.push({ id: uid("column"), name: clean(name) || "Nova etapa" }); return state; });
  const renameColumn = (funnelId, columnId, name) => updateState((state) => { const funnel = state.funnels.find((item) => item.id === funnelId); const column = funnel && funnel.columns.find((item) => item.id === columnId); if (column && clean(name)) column.name = clean(name); return state; });
  const deleteColumn = (funnelId, columnId) => updateState((state) => { const funnel = state.funnels.find((item) => item.id === funnelId); if (!funnel || funnel.columns.length <= 1) return state; const fallback = funnel.columns.find((column) => column.id !== columnId); funnel.columns = funnel.columns.filter((column) => column.id !== columnId); state.clients.forEach((client) => { if (client.funnelId === funnelId && client.columnId === columnId) client.columnId = fallback.id; }); return state; });

  const upsertClient = (client) => updateState((state) => {
    const stamp = now();
    const incomingPhone = phoneKey(client.phone);
    const incomingKey = clean(client.waKey) || incomingPhone || clean(client.chatTitle) || clean(client.name);
    const index = state.clients.findIndex((item) => {
      const sameId = client.id && item.id === client.id;
      const samePhone = incomingPhone && phoneKey(item.phone) === incomingPhone;
      const sameKey = incomingKey && item.waKey === incomingKey;
      return sameId || samePhone || sameKey;
    });
    const previous = index >= 0 ? state.clients[index] : {};
    const merged = normalizeClient({ ...previous, ...client, waKey: incomingKey, updatedAt: stamp }, state);
    merged.createdAt = previous.createdAt || client.createdAt || stamp;
    if (index >= 0) state.clients[index] = merged;
    else state.clients.push({ ...merged, id: client.id || uid("client") });
    return state;
  });

  const deleteClient = (clientId) => updateState((state) => { state.clients = state.clients.filter((client) => client.id !== clientId); state.pinnedClientIds = state.pinnedClientIds.filter((id) => id !== clientId); return state; });
  const moveClient = (clientId, columnId) => updateState((state) => { const client = state.clients.find((item) => item.id === clientId); if (client) { client.columnId = columnId; client.updatedAt = now(); } return state; });
  const addNote = (clientId, text) => updateState((state) => { const client = state.clients.find((item) => item.id === clientId); if (client && clean(text)) { client.notes.unshift({ id: uid("note"), text: clean(text), createdAt: now() }); client.updatedAt = now(); } return state; });
  const addReminder = (clientId, reminder) => updateState((state) => { const client = state.clients.find((item) => item.id === clientId); const title = clean(reminder && (reminder.title || reminder.text)); if (client && title) { client.reminders.unshift({ id: uid("reminder"), title, dueAt: clean(reminder.dueAt), note: clean(reminder.note), done: false, createdAt: now() }); client.nextAction = client.nextAction || title; client.updatedAt = now(); } return state; });
  const togglePinned = (clientId) => updateState((state) => { const client = state.clients.find((item) => item.id === clientId); if (!client) return state; const pinned = !state.pinnedClientIds.includes(clientId); state.pinnedClientIds = pinned ? [...state.pinnedClientIds, clientId] : state.pinnedClientIds.filter((id) => id !== clientId); client.pinned = pinned; client.updatedAt = now(); return state; });
  const saveDetectedChats = (detectedChats) => updateState((state) => { state.detectedChats = asArray(detectedChats).map(normalizeDetectedChat).slice(0, 60); return state; });
  const importState = async (incoming) => { const state = normalizeState(incoming); await writeRaw(state); return state; };

  window.CodeWhatsStorage = { STORAGE_KEY, uid, getState, saveState, updateState, createFunnel, createColumn, renameColumn, deleteColumn, upsertClient, deleteClient, moveClient, addNote, addReminder, togglePinned, saveDetectedChats, importState };
})();
