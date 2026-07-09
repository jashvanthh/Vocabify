document.addEventListener("DOMContentLoaded", async () => {
  const { openai_api_key, use_ai } = await chrome.storage.local.get([
    "openai_api_key",
    "use_ai"
  ]);
  if (openai_api_key) document.getElementById("apiKey").value = openai_api_key;
  document.getElementById("useAI").checked = use_ai ?? false;
});

document.getElementById("save").onclick = async () => {
  const key = document.getElementById("apiKey").value.trim();
  const useAI = document.getElementById("useAI").checked;
  await chrome.storage.local.set({ openai_api_key: key, use_ai: useAI });
  document.getElementById("status").textContent = "✅ Saved successfully!";
  setTimeout(() => (document.getElementById("status").textContent = ""), 2000);
};
