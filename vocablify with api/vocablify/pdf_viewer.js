// pdf_viewer.js — fully selectable PDF + Vocablify overlay
const container = document.getElementById("pdf-container");
const fileInput = document.getElementById("file-input");

// enable text selection listener for Vocablify
function setupHighlightListener() {
  document.addEventListener("mouseup", () => {
    const selection = window.getSelection().toString().trim();
    if (selection) {
      chrome.runtime.sendMessage({ action: "highlighted_text", text: selection });
    }
  });
}

// render PDF file
async function renderPDF(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  container.innerHTML = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.2 });

    // Page wrapper
    const pageDiv = document.createElement("div");
    pageDiv.className = "page";
    pageDiv.style.width = viewport.width + "px";
    pageDiv.style.height = viewport.height + "px";

    // Canvas for rendering page graphics
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageDiv.appendChild(canvas);

    // Text layer for real selectable text
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.position = "absolute";
    textLayerDiv.style.top = "0";
    textLayerDiv.style.left = "0";
    textLayerDiv.style.height = "100%";
    textLayerDiv.style.width = "100%";
    textLayerDiv.style.pointerEvents = "none";
    pageDiv.appendChild(textLayerDiv);

    container.appendChild(pageDiv);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const textContent = await page.getTextContent();
    pdfjsLib.renderTextLayer({
      textContent,
      container: textLayerDiv,
      viewport,
      textDivs: [],
    });
  }

  setupHighlightListener();
}

// file upload handler
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  renderPDF(buffer);
});

// auto-open PDFs clicked in Chrome
if (window.location.search.startsWith("?file=")) {
  const url = decodeURIComponent(window.location.search.split("=")[1]);
  fetch(url)
    .then((res) => res.arrayBuffer())
    .then((buf) => renderPDF(buf))
    .catch((err) => console.error("Failed to load PDF:", err));
}
// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdfjs/pdf.worker.js");
