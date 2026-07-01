(function () {
  const storage = window.CodeWhatsStorage;
  let state = null;

  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  });

  const renderStats = () => {
    const activeFunnel =
      state.funnels.find((funnel) => funnel.id === state.activeFunnelId) || state.funnels[0];
    const clients = state.clients.filter((client) => client.funnelId === activeFunnel.id);
    const value = clients.reduce((sum, client) => sum + (Number(client.value) || 0), 0);
    const hot = clients.filter((client) => client.temperature === "quente").length;

    document.querySelector('[data-role="popup-stats"]').innerHTML = `
      <span>${clients.length} clientes</span>
      <span>${hot} quentes</span>
      <span>${money.format(value)}</span>
    `;
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

  document.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    if (!action) return;

    if (action === "open-whatsapp") {
      chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    }

    if (action === "export-backup") {
      downloadBackup();
    }

    if (action === "import-backup") {
      document.querySelector('[data-role="backup-file"]').click();
    }
  });

  document.addEventListener("change", async (event) => {
    if (!event.target.matches('[data-role="backup-file"]') || !event.target.files[0]) return;

    try {
      const text = await event.target.files[0].text();
      state = await storage.importState(JSON.parse(text));
      renderStats();
    } catch (error) {
      alert("Não foi possível importar o backup. Verifique se o JSON é válido.");
    }
  });

  const boot = async () => {
    state = await storage.getState();
    renderStats();
  };

  boot();
})();
