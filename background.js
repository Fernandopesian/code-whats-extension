if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => null);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "CWL_OPEN_CRM_WINDOW") return false;

  chrome.windows.create({
    url: chrome.runtime.getURL("crm.html"),
    type: "popup",
    width: 1200,
    height: 780,
    focused: true
  }, (createdWindow) => {
    sendResponse({ ok: Boolean(createdWindow), windowId: createdWindow && createdWindow.id });
  });

  return true;
});
