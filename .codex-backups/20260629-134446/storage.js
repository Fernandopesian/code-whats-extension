(function () {
  const STORAGE_KEY = "codeWhatsLocalState";
  const CURRENT_VERSION = 2;

  const uid = (prefix) =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

  const now = () => new Date().toISOString();

  const defaultColumns = () => [
    { id: uid("column"), name: "Novo" },
    { id: uid("column"), name: "Em atendimento" },
    { id: uid("column"), name: "Follow-up" },
    { id: uid("column"), name: "Fechado" }
  ];

  const sampleState = () => {
    const funnelNames = ["Clientes", "Parceiros", "Construtoras", "Pos-venda"];
    const funnels = funnelNames.map((name) => ({ id: uid("funnel"), name, columns: defaultColumns() }));
    const clientFunnel = funnels[0];

    return {
      version: CURRENT_VERSION,
      activeFunnelId: clientFunnel.id,
      activeView: "kanban",
      drawerOpen: true,
      createdAt: now(),
      funnels,
      clients: [
        {
          id: uid("client"),
          funnelId: clientFunnel.id,
          columnId: clientFunnel.columns[0].id,
          name: "Contato do WhatsApp",
          phone: "",
          chatTitle: "Contato do WhatsApp",
          waKey: "sample-contact",
          label: "Exemplo local",
          temperature: "morno",
          value: 0,
          note: "Use o botao contextual na conversa aberta para salvar contatos reais.",
          nextAction: "Adicionar o primeiro contato real ao funil.",
          pinned: false,
          notes: [],
          reminders: [],
          captured: {},
          createdAt: now(),
          updatedAt: now()
        }
      ],
      futureTools: {
        scheduledMessages: [],
        quickScripts: [],
        aiSummaries: [],
        timeline: [],
        commercialScores: [],
        googleCalendar: [],
        conversationAnalysis: []
      }
    };
  };

  const asArray = (value) => (Array.isArray(value) ? value : []);
  const clean = (value) => String(value || "").trim();
  const number = (value) => Number(value) || 0;

  const normalizeFunnel = (funnel) => {
    const columns = asArray(funnel && funnel.columns).length
      ? funnel.columns.map((column) => ({
          id: column.id || uid("column"),
          name: clean(column.name) || "Etapa"
        }))
      : defaultColumns();

    return {
      id: funnel.id || uid("funnel"),
      name: clean(funnel.name) || "Funil sem nome",
      columns
    };
  };

  const normalizeClient = (client, state) => {
    const fallbackFunnel = state.funnels[0];
    const funnel = state.funnels.find((item) => item.id === client.funnelId) || fallbackFunnel;
    const firstColumnId = funnel && funnel.columns[0] ? funnel.columns[0].id : "";
    const columnExists = funnel && funnel.columns.some((column) => column.id === client.columnId);

    return {
      id: client.id || uid("client"),
      funnelId: funnel ? funnel.id : "",
      columnId: columnExists ? client.columnId : firstColumnId,
      name: clean(client.name) || clean(client.chatTitle) || "Contato sem nome",
      phone: clean(client.phone),
      chatTitle: clean(client.chatTitle) || clean(client.name),
      waKey: clean(client.waKey) || clean(client.phone) || clean(client.chatTitle) || uid("wa"),
      label: clean(client.label),
      temperature: ["frio", "morno", "quente"].includes(client.temperature) ? client.temperature : "morno",
      value: number(client.value),
      note: clean(client.note),
      nextAction: clean(client.nextAction),
      pinned: Boolean(client.pinned),
      notes: asArray(client.notes).map((note) => ({
        id: note.id || uid("note"),
        text: clean(note.text),
        createdAt: note.createdAt || now()
      })).filter((note) => note.text),
      reminders: asArray(client.reminders).map((reminder) => ({
        id: reminder.id || uid("reminder"),
        text: clean(reminder.text),
        dueAt: reminder.dueAt || "",
        done: Boolean(reminder.done),
        createdAt: reminder.createdAt || now()
      })).filter((reminder) => reminder.text),
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
      futureTools: {
        scheduledMessages: asArray(input.futureTools && input.futureTools.scheduledMessages),
        quickScripts: asArray(input.futureTools && input.futureTools.quickScripts),
        aiSummaries: asArray(input.futureTools && input.futureTools.aiSummaries),
        timeline: asArray(input.futureTools && input.futureTools.timeline),
        commercialScores: asArray(input.futureTools && input.futureTools.commercialScores),
        googleCalendar: asArray(input.futureTools && input.futureTools.googleCalendar),
        conversationAnalysis: asArray(input.futureTools && input.futureTools.conversationAnalysis)
      }
    };

    if (!state.funnels.some((funnel) => funnel.id === state.activeFunnelId)) {
      state.activeFunnelId = state.funnels[0].id;
    }

    state.clients = asArray(input.clients).map((client) => normalizeClient(client, state));
    return state;
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const readRaw = () =>
    new Promise((resolve) => chrome.storage.local.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY])));

  const writeRaw = (state) =>
    new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve));

  const getState = async () => {
    const state = normalizeState(await readRaw());
    await writeRaw(state);
    return state;
  };

  const saveState = async (nextState) => {
    const state = normalizeState(nextState);
    await writeRaw(state);
    return state;
  };

  const updateState = async (updater) => {
    const current = await getState();
    return saveState(updater(clone(current)) || current);
  };

  const createFunnel = (name) =>
    updateState((state) => {
      const funnel = { id: uid("funnel"), name: clean(name) || "Novo funil", columns: defaultColumns() };
      state.funnels.push(funnel);
      state.activeFunnelId = funnel.id;
      return state;
    });

  const createColumn = (funnelId, name) =>
    updateState((state) => {
      const funnel = state.funnels.find((item) => item.id === funnelId);
      if (funnel) funnel.columns.push({ id: uid("column"), name: clean(name) || "Nova etapa" });
      return state;
    });

  const renameColumn = (funnelId, columnId, name) =>
    updateState((state) => {
      const funnel = state.funnels.find((item) => item.id === funnelId);
      const column = funnel && funnel.columns.find((item) => item.id === columnId);
      if (column && clean(name)) column.name = clean(name);
      return state;
    });

  const deleteColumn = (funnelId, columnId) =>
    updateState((state) => {
      const funnel = state.funnels.find((item) => item.id === funnelId);
      if (!funnel || funnel.columns.length <= 1) return state;
      const fallback = funnel.columns.find((column) => column.id !== columnId);
      funnel.columns = funnel.columns.filter((column) => column.id !== columnId);
      state.clients.forEach((client) => {
        if (client.funnelId === funnelId && client.columnId === columnId) client.columnId = fallback.id;
      });
      return state;
    });

  const upsertClient = (client) =>
    updateState((state) => {
      const stamp = now();
      const key = clean(client.waKey) || clean(client.phone) || clean(client.chatTitle) || clean(client.name);
      const index = state.clients.findIndex((item) =>
        (client.id && item.id === client.id) || (key && item.waKey === key)
      );
      const previous = index >= 0 ? state.clients[index] : {};
      const payload = normalizeClient({ ...previous, ...client, waKey: key, updatedAt: stamp }, state);
      payload.createdAt = previous.createdAt || client.createdAt || stamp;
      if (index >= 0) state.clients[index] = payload;
      else state.clients.push({ ...payload, id: client.id || uid("client") });
      return state;
    });

  const deleteClient = (clientId) =>
    updateState((state) => {
      state.clients = state.clients.filter((client) => client.id !== clientId);
      return state;
    });

  const moveClient = (clientId, columnId) =>
    updateState((state) => {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) {
        client.columnId = columnId;
        client.updatedAt = now();
      }
      return state;
    });

  const addNote = (clientId, text) =>
    updateState((state) => {
      const client = state.clients.find((item) => item.id === clientId);
      if (client && clean(text)) {
        client.notes.unshift({ id: uid("note"), text: clean(text), createdAt: now() });
        client.updatedAt = now();
      }
      return state;
    });

  const addReminder = (clientId, text, dueAt) =>
    updateState((state) => {
      const client = state.clients.find((item) => item.id === clientId);
      if (client && clean(text)) {
        client.reminders.unshift({ id: uid("reminder"), text: clean(text), dueAt: dueAt || "", done: false, createdAt: now() });
        client.nextAction = client.nextAction || clean(text);
        client.updatedAt = now();
      }
      return state;
    });

  const togglePinned = (clientId) =>
    updateState((state) => {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) {
        client.pinned = !client.pinned;
        client.updatedAt = now();
      }
      return state;
    });

  const importState = async (incoming) => {
    const state = normalizeState(incoming);
    await writeRaw(state);
    return state;
  };

  window.CodeWhatsStorage = {
    STORAGE_KEY,
    uid,
    getState,
    saveState,
    updateState,
    createFunnel,
    createColumn,
    renameColumn,
    deleteColumn,
    upsertClient,
    deleteClient,
    moveClient,
    addNote,
    addReminder,
    togglePinned,
    importState
  };
})();
