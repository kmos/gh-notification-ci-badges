const patInput = document.getElementById("pat");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

chrome.storage.local.get("githubPAT", (data) => {
  if (data.githubPAT) patInput.value = data.githubPAT;
});

saveBtn.addEventListener("click", () => {
  const pat = patInput.value.trim();
  if (!pat) {
    statusEl.textContent = "Token cannot be empty.";
    statusEl.className = "status status-err";
    return;
  }
  chrome.storage.local.set({ githubPAT: pat }, () => {
    statusEl.textContent = "Saved.";
    statusEl.className = "status status-ok";
  });
});
