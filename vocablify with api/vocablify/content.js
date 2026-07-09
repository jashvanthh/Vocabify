// content.js — Vocablify final polished (meaning + summary + save + saved list + quiz)
// Drop this file into your extension and reload the extension in chrome://extensions

(function () {
  const ID = "voc-popup";
  if (document.getElementById(ID)) return;

  // --------- storage helpers (promisify chrome.storage) ----------
  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (e) {
        // fallback for environments without chrome (testing)
        resolve({});
      }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  // --------- create popup element ----------
  const popup = document.createElement("div");
  popup.id = ID;
  document.body.appendChild(popup);

  Object.assign(popup.style, {
    position: "absolute",
    zIndex: 2147483647,
    display: "none",
    background: "#0f172a",
    color: "#f1f5f9",
    borderRadius: "12px",
    maxWidth: "420px",
    fontFamily: "'Inter', Arial, sans-serif",
    fontSize: "14px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
    padding: "12px",
    transition: "all 0.16s ease",
    maxHeight: "520px",
    overflow: "hidden",
  });

  const hide = () => (popup.style.display = "none");

  function posRect(rect) {
    const margin = 8;
    const top = rect.bottom + window.scrollY + 10;
    let left = rect.left + window.scrollX;
    // ensure it doesn't overflow horizontally
    const width = popup.offsetWidth || 380;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }

  // --------- toast ----------
  function showToast(message, background = "#3b82f6") {
    let t = popup.querySelector(".voc-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "voc-toast";
      Object.assign(t.style, {
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "-48px",
        background,
        color: "#fff",
        padding: "8px 12px",
        borderRadius: "8px",
        fontSize: "13px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        opacity: "0",
        transition: "all 280ms cubic-bezier(.2,.9,.3,1)",
        pointerEvents: "none",
      });
      popup.appendChild(t);
    }
    t.textContent = message;
    t.style.background = background;
    requestAnimationFrame(() => {
      t.style.opacity = "1";
      t.style.bottom = "-12px";
      t.style.transform = "translateX(-50%) scale(1.02)";
    });
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.bottom = "-48px";
      t.style.transform = "translateX(-50%) scale(0.98)";
    }, 2000);
  }

  // --------- html escaping ----------
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // --------- dictionary fallback helper ----------
  async function fetchDictionary(word) {
    try {
      const r = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
      );
      if (!r.ok) throw new Error("no-dict");
      const j = await r.json();
      const entry = j?.[0];
      const meaning =
        entry?.meanings?.[0]?.definitions?.[0]?.definition || "Definition unavailable.";
      const part = entry?.meanings?.[0]?.partOfSpeech || "";
      return { meaning, part };
    } catch (e) {
      return null;
    }
  }

  // --------- Wikipedia fallback (used if background/GPT fails) ----------
  async function wikiSummaryFor(word) {
    try {
      // try opensearch to get best title (CORS allowed with origin=*)
      const sres = await fetch(
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
          word
        )}&limit=1&namespace=0&format=json&origin=*`
      );
      if (!sres.ok) return null;
      const sjson = await sres.json();
      const title = sjson?.[1]?.[0] || word;
      const tres = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!tres.ok) return null;
      const tjson = await tres.json();
      return tjson.extract || null;
    } catch (e) {
      return null;
    }
  }

  // --------- context-aware meaning (ask background first, fallback to dictionary/wiki) ----------
  async function fetchContextMeaning(word, sentence) {
    // prefer to ask background (which uses stored API key)
    try {
      // ask background
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "ai_disambiguate", word, sentence }, (r) =>
          resolve(r)
        );
      });
      if (resp && !resp.error && (resp.meaning || resp.part)) {
        return { meaning: resp.meaning || "", part: resp.part || "contextual" };
      }
    } catch (e) {
      // continue to fallback
      console.warn("background message error", e);
    }

    // fallback: dictionary
    const dict = await fetchDictionary(word);
    if (dict) return dict;

    // fallback: wiki
    const wiki = await wikiSummaryFor(word);
    if (wiki) return { meaning: wiki, part: "proper noun / entity" };

    // last fallback
    return { meaning: "No meaning found.", part: "" };
  }

  // --------- Save / Saved list / export / delete ----------
  async function saveWord(word, meaning, part, btn) {
    const { vocablify_words = [] } = await storageGet(["vocablify_words"]);
    const found = (vocablify_words || []).find(
      (w) => String(w.word || "").toLowerCase() === String(word || "").toLowerCase()
    );
    if (found) {
      showToast(`⚠️ "${word}" is already saved.`, "#ef4444");
      return;
    }
    // animate button
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "Saving...";
      btn.style.background = "#38bdf8";
      btn.disabled = true;
      await new Promise((r) => setTimeout(r, 420));
      vocablify_words.push({ word, meaning, part, savedAt: Date.now() });
      await storageSet({ vocablify_words });
      btn.textContent = "Saved!";
      btn.style.background = "#22c55e";
      showToast(`✅ Saved "${word}"`, "#10b981");
      setTimeout(() => {
        btn.textContent = original;
        btn.style.background = "#10b981";
        btn.disabled = false;
      }, 700);
    } else {
      vocablify_words.push({ word, meaning, part, savedAt: Date.now() });
      await storageSet({ vocablify_words });
    }
  }

  async function renderSavedListHtml() {
    const { vocablify_words = [] } = await storageGet(["vocablify_words"]);
    if (!vocablify_words || vocablify_words.length === 0) {
      return `<div style="color:#94a3b8;padding:6px 0;">No saved words yet.</div>`;
    }
    // show newest first
    const reversed = [...vocablify_words].slice().reverse();
    const listHtml = reversed
      .map(
        (w, idx) => `
      <div class="voc-saved-item" data-idx="${reversed.length - 1 - idx}" style="border-bottom:1px solid #172033;padding:8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            <b style="color:#38bdf8;">${escapeHtml(w.word)}</b>
            <div style="font-size:12px;color:#94a3b8;">${escapeHtml(w.part)}</div>
            <div style="font-size:12px;color:#cbd5e1;margin-top:6px;">${escapeHtml(w.meaning)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button class="voc-export-elem" data-idx="${reversed.length - 1 - idx}" style="background:#3b82f6;border:none;color:white;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;">Export</button>
            <button class="voc-del-elem" data-idx="${reversed.length - 1 - idx}" style="background:#ef4444;border:none;color:white;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;">Delete</button>
          </div>
        </div>
      </div>`
      )
      .join("");
    const actions = `
      <div style="margin-top:8px;display:flex;gap:10px;align-items:center;">
        <button id="voc-clear-all" style="background:#ef4444;border:none;color:white;padding:8px;border-radius:8px;cursor:pointer;">Clear All</button>
        <button id="voc-export-all" style="background:#10b981;border:none;color:white;padding:8px;border-radius:8px;cursor:pointer;">Export All (JSON)</button>
      </div>`;
    return `<div style="max-height:260px;overflow:auto;padding-right:6px;">${listHtml}</div>${actions}`;
  }

  async function exportAllJson() {
    const { vocablify_words = [] } = await storageGet(["vocablify_words"]);
    const blob = new Blob([JSON.stringify(vocablify_words, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vocablify_saved_words.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // --------- Quiz helpers ----------
  // returns an array of 10 question objects {word, meaning, part, type, options, correctIndex}
  async function buildQuizFromSaved() {
    const { vocablify_words = [] } = await storageGet(["vocablify_words"]);
    const pool = vocablify_words || [];
    if (pool.length < 2) return null;
    // shuffle copy
    const available = [...pool];
    // shuffle
    for (let i = available.length - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [available[i], available[r]] = [available[r], available[i]];
    }
    const questions = [];
    const maxQ = Math.min(10, available.length);
    const usedWords = new Set();
    let idx = 0;
    while (questions.length < maxQ && idx < available.length) {
      const q = available[idx++];
      if (usedWords.has(q.word.toLowerCase())) continue;
      usedWords.add(q.word.toLowerCase());
      // randomize type: meaning or part-of-speech (pos)
      const type = Math.random() < 0.6 ? "meaning" : "pos";
      let options = [];
      let correctIndex = 0;
      if (type === "meaning") {
        const correct = q.meaning;
        options = [correct];
        // pick distractors from other meanings
        const distractors = pool
          .map((p) => p.meaning)
          .filter((m) => m && m !== correct);
        // shuffle distractors
        for (let i = distractors.length - 1; i > 0 && options.length < 4; i--) {
          const r = Math.floor(Math.random() * (i + 1));
          [distractors[i], distractors[r]] = [distractors[r], distractors[i]];
        }
        for (let d of distractors) {
          if (options.length >= 4) break;
          if (!options.includes(d)) options.push(d);
        }
        // fallback dummy
        let k = 1;
        while (options.length < 4) {
          options.push(`Incorrect meaning ${k}`);
          k++;
        }
        // shuffle options
        options.sort(() => Math.random() - 0.5);
        correctIndex = options.indexOf(correct);
      } else {
        // pos question
        const correct = q.part || "noun";
        const posList = ["noun", "verb", "adjective", "adverb", "preposition", "conjunction", "proper noun"];
        options = [correct];
        while (options.length < 4) {
          const pick = posList[Math.floor(Math.random() * posList.length)];
          if (!options.includes(pick)) options.push(pick);
        }
        options.sort(() => Math.random() - 0.5);
        correctIndex = options.indexOf(correct);
      }
      questions.push({
        word: q.word,
        meaning: q.meaning,
        part: q.part,
        type,
        options,
        correctIndex,
      });
    }
    return questions;
  }

  async function renderQuizUi(questions) {
    // state
    let index = 0;
    let score = 0;

    function renderQuestion() {
      const q = questions[index];
      const progress = `${index + 1}/${questions.length}`;
      const optHtml = q.options
        .map(
          (opt, i) => `<button class="voc-quiz-opt" data-i="${i}" style="display:block;width:100%;text-align:left;padding:10px;border-radius:8px;border:none;background:#0f172a;color:#f1f5f9;margin-top:8px;cursor:pointer;">
            ${escapeHtml(opt)}
          </button>`
        )
        .join("");
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:700;color:#38bdf8;">${escapeHtml(q.word)}</div>
          <div style="color:#94a3b8;font-size:13px;">${progress}</div>
        </div>
        <div style="color:#cbd5e1;margin-bottom:8px;">${q.type === "meaning" ? "Choose the correct meaning:" : "Choose the correct part of speech:"}</div>
        ${optHtml}
        <div style="margin-top:10px;text-align:center;">
          <div id="voc-quiz-feedback" style="min-height:22px;color:#cbd5e1;"></div>
        </div>
      `;
    }

    // place inside voc-extra
    const extra = popup.querySelector("#voc-extra");
    if (!extra) return;
    extra.innerHTML = renderQuestion();

    function attachHandlers() {
      extra.querySelectorAll(".voc-quiz-opt").forEach((b) => {
        b.onclick = () => {
          const i = Number(b.dataset.i);
          const q = questions[index];
          if (i === q.correctIndex) {
            b.style.background = "#22c55e";
            b.textContent = "✅ " + b.textContent;
            score++;
            showToast("Correct!", "#10b981");
          } else {
            b.style.background = "#ef4444";
            b.textContent = "❌ " + b.textContent;
            showToast("Wrong!", "#ef4444");
            // mark correct
            const correctBtn = extra.querySelector(`.voc-quiz-opt[data-i="${q.correctIndex}"]`);
            if (correctBtn) {
              correctBtn.style.background = "#22c55e";
            }
          }
          // disable all options
          extra.querySelectorAll(".voc-quiz-opt").forEach((btn) => (btn.disabled = true));
          // after short delay go next question or finish
          setTimeout(() => {
            index++;
            if (index >= questions.length) {
              // finish
              const finalHtml = `
                <div style="text-align:center;">
                  <div style="font-size:18px;font-weight:800;color:#38bdf8;margin-bottom:8px;">Score ${score}/${questions.length}</div>
                  <div style="color:#cbd5e1;margin-bottom:12px;">${score === questions.length ? "🏆 Perfect! Vocabulary master!" : score >= Math.ceil(questions.length*0.8) ? "🎉 Great! Well done!" : score >= Math.ceil(questions.length*0.5) ? "👏 Nice effort — keep practicing!" : "💪 Keep learning — you'll improve!"}</div>
                  <div style="display:flex;gap:8px;justify-content:center;">
                    <button id="voc-try-again" style="background:#3b82f6;color:white;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">Try Again</button>
                    <button id="voc-quiz-close" style="background:#475569;color:white;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">Close</button>
                  </div>
                </div>
              `;
              extra.innerHTML = finalHtml;
              const again = extra.querySelector("#voc-try-again");
              const closeBtn = extra.querySelector("#voc-quiz-close");
              again.onclick = async () => {
                const newQ = await buildQuizFromSaved();
                if (!newQ) {
                  extra.innerHTML = "<div style='color:#94a3b8;'>Not enough saved words</div>";
                  return;
                }
                // restart
                questions = newQ;
                index = 0;
                score = 0;
                extra.innerHTML = renderQuestion();
                attachHandlers();
              };
              closeBtn.onclick = () => {
                extra.innerHTML = "";
              };
            } else {
              extra.innerHTML = renderQuestion();
              attachHandlers();
            }
          }, 700);
        };
      });
    }

    attachHandlers();
  }

  // --------- UI building: showMain and showSummary ----------
  function buildLogoDataUri() {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#3b82f6'/><stop offset='100%' stop-color='#38bdf8'/></linearGradient></defs><rect rx='12' width='64' height='64' fill='url(#g)'/><text x='50%' y='56%' font-family='Arial' font-size='32' fill='white' text-anchor='middle' font-weight='700'>V</text></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  async function showMain(word, meaning, part, rect) {
    const logo = buildLogoDataUri();
    popup.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
        <img src="${logo}" width="36" height="36" style="border-radius:8px;">
        <div style="flex:1;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:800;color:#38bdf8;font-size:15px;">${escapeHtml(word)}</div>
              <div style="color:#94a3b8;font-size:12px;margin-top:2px;">${escapeHtml(part)}</div>
            </div>
            <div id="voc-progress" style="color:#94a3b8;font-size:12px;"></div>
          </div>
        </div>
      </div>

      <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;max-height:200px;overflow:auto;">${escapeHtml(meaning)}</div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="voc-save" style="background:#10b981;color:white;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;">Save</button>
        <button id="voc-saved" style="background:#f59e0b;color:white;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;">Saved Words</button>
        <button id="voc-quiz" style="background:#3b82f6;color:white;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;">Quiz</button>
        <button id="voc-close" style="background:#475569;color:white;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;">Close</button>
      </div>

      <div id="voc-extra" style="margin-top:10px;max-height:200px;overflow:auto;"></div>
    `;
    popup.style.display = "block";
    posRect(rect);

    // handlers
    popup.querySelector("#voc-close").onclick = hide;
    popup.querySelector("#voc-save").onclick = (e) => saveWord(word, meaning, part, e.target);

    // saved words view
    popup.querySelector("#voc-saved").onclick = async () => {
      const container = popup.querySelector("#voc-extra");
      container.innerHTML = "<div style='color:#94a3b8;'>Loading...</div>";
      const html = await renderSavedListHtml();
      container.innerHTML = html;

      // attach delete handlers
      container.querySelectorAll(".voc-del-elem").forEach((btn) => {
        btn.onclick = async (ev) => {
          const idx = Number(btn.dataset.idx);
          const { vocablify_words = [] } = await storageGet(["vocablify_words"]);
          vocablify_words.splice(idx, 1);
          await storageSet({ vocablify_words });
          container.innerHTML = await renderSavedListHtml();
        };
      });

      // export single
      container.querySelectorAll(".voc-export-elem").forEach((btn) => {
        btn.onclick = async () => {
          const idx = Number(btn.dataset.idx);
          const { vocablify_words = [] } = await storageGet(["vocablify_words"]);
          const entry = vocablify_words[idx];
          if (!entry) return showToast("Nothing to export", "#ef4444");
          const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${entry.word || "word"}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast("Exported", "#3b82f6");
        };
      });

      // clear all
      const clearAll = container.querySelector("#voc-clear-all");
      if (clearAll) {
        clearAll.onclick = async () => {
          await storageSet({ vocablify_words: [] });
          container.innerHTML = await renderSavedListHtml();
          showToast("Cleared all saved words", "#ef4444");
        };
      }

      const exportAllBtn = container.querySelector("#voc-export-all");
      if (exportAllBtn) {
        exportAllBtn.onclick = exportAllJson;
      }
    };

    // quiz
    popup.querySelector("#voc-quiz").onclick = async () => {
      const questions = await buildQuizFromSaved();
      const container = popup.querySelector("#voc-extra");
      if (!questions || questions.length < 1) {
        container.innerHTML = `<div style="color:#94a3b8;">Save at least 2 words for a quiz.</div>`;
        return;
      }
      // show initial quiz UI
      container.innerHTML = `<div style="color:#94a3b8;">Generating quiz...</div>`;
      // tiny delay for UX
      setTimeout(() => {
        renderQuizUi(questions);
      }, 200);
    };
  }

  function showSummaryPopup(summary, rect) {
    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:800;color:#38bdf8;">Simplified Summary</div>
        <div><button id="voc-close-sum" style="background:#475569;color:white;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">Close</button></div>
      </div>
      <div style="font-size:13px;color:#cbd5e1;max-height:360px;overflow:auto;white-space:pre-wrap;">${escapeHtml(
        summary
      )}</div>
    `;
    popup.style.display = "block";
    posRect(rect);
    const btn = popup.querySelector("#voc-close-sum");
    if (btn) btn.onclick = hide;
  }

  // --------- improved summarizer (sentence scoring + some normalization) ----------
  async function summarizeText(text) {
    if (!text || !text.trim()) return "";
    const cleaned = text.replace(/\s+/g, " ").trim();
    const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
    if (sentences.length <= 2) return cleaned;

    // build word frequency excluding small/common words
    const stop = new Set([
      "the","and","for","are","that","with","this","from","was","were","have","has","had","but","not","you","your","they","their","them","its","it's","a","an","of","in","to","on","as","by","be","is","at","or","we","our","he","she","his","her","which"
    ]);
    const words = cleaned
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !stop.has(w) && w.length > 2);
    const freq = {};
    words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));
    const maxF = Math.max(...Object.values(freq), 1);
    Object.keys(freq).forEach((k) => (freq[k] = freq[k] / maxF));

    // score sentences
    const scored = sentences.map((s, idx) => {
      const toks = s
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t && !stop.has(t) && t.length > 2);
      const score = toks.reduce((acc, t) => acc + (freq[t] || 0), 0);
      return { idx, sentence: s.trim(), score };
    });

    // choose top N sentences where N depends on length
    const N = Math.min(3, Math.max(2, Math.floor(sentences.length / 4)));
    const top = scored.slice().sort((a, b) => b.score - a.score).slice(0, N).sort((a, b) => a.idx - b.idx);
    // join and return
    return top.map((t) => t.sentence).join(" ").trim();
  }

  // --------- Selection handling ----------
  let timer, lastSelection = "";
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const sel = window.getSelection();
        if (!sel || !sel.toString().trim()) return hide();
        const text = sel.toString().trim();
        if (!text) return hide();
        if (text === lastSelection) return;
        lastSelection = text;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if ((!rect.width || !rect.height) && !range.getClientRects().length) return hide();

        const words = text.split(/\s+/);
        const isParagraph = words.length > 3 || /[.?!,;]/.test(text);

        if (isParagraph) {
          const summary = await summarizeText(text);
          showSummaryPopup(summary, rect);
        } else {
          // find the sentence context: take anchor node text and locate containing sentence
          const anchorText = sel.anchorNode?.textContent || text;
          const sentenceContext = (anchorText || "").split(/(?<=[.?!])\s+/).find((s) => s.includes(text)) || text;
          const { meaning, part } = await fetchContextMeaning(text, sentenceContext);
          showMain(text, meaning, part, rect);
        }
      } catch (e) {
        console.error("selection handler error", e);
        hide();
      }
    }, 260);
  });

  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target)) {
      hide();
    }
  });

  // expose for debug (optional)
  window.__vocablify = {
    fetchContextMeaning,
    summarizeText,
    saveWord,
    renderSavedListHtml,
    buildQuizFromSaved,
  };
})();
