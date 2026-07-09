// background.js — Vocablify AI meaning disambiguation handler

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.action === "ai_disambiguate") {
      try {
        const { openai_api_key, use_ai } = await chrome.storage.local.get([
          "openai_api_key",
          "use_ai",
        ]);

        if (!use_ai || !openai_api_key) {
          sendResponse({ error: "AI disabled or no key configured." });
          return;
        }

        const prompt = `
You are a dictionary assistant. Based on the context below, explain what "${msg.word}" means.
Context: "${msg.sentence}"
Return only the most relevant meaning and its part of speech, in concise form.
`;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openai_api_key}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 120,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          sendResponse({ error: `OpenAI error: ${errText}` });
          return;
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim();

        sendResponse({
          meaning: reply || "No contextual meaning found.",
          part: "contextual",
        });
      } catch (err) {
        console.error("AI disambiguate failed:", err);
        sendResponse({ error: "Failed to call OpenAI." });
      }
    }
  })();

  // returning true keeps message channel open for async sendResponse
  return true;
});
