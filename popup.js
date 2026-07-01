(function () {
  const api = window.CodeWhatsStorage;

  function renderStatus(state) {
    const el = document.querySelector('[data-role="popup-status"]');
    if (!el) return;
    el.textContent = state.authenticated ? `Status: conectado (${state.syncStatus})` : `Status: login obrigatório (${state.syncStatus})`;
  }

  document.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (action === "open-whatsapp") chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    if (action === "open-pipeline") chrome.runtime.sendMessage({ type: "CWL_OPEN_CRM_WINDOW" });
  });

  api.restoreSession().then(renderStatus);
})();

