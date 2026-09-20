"use client";

export type ExtractionProgress = { stage: string; progress: number };

export async function extractTherapyNote(
  file: File,
  onProgress: (progress: ExtractionProgress) => void
) {
  const lower = file.name.toLowerCase();
  if (file.type === "text/plain" || lower.endsWith(".txt") || lower.endsWith(".md")) {
    onProgress({ stage: "Reading text", progress: 1 });
    return file.text();
  }
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    onProgress({ stage: "Reading PDF text", progress: 0.15 });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      onProgress({ stage: `Reading PDF page ${pageNumber}`, progress: pageNumber / pdf.numPages });
    }
    const text = pages.join("\n\n").trim();
    if (text.length >= 30) return text;
    onProgress({ stage: "Scanned PDF needs OCR", progress: 0.05 });
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const ocrPages: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) throw new Error("Canvas is unavailable for PDF OCR");
        await page.render({ canvas, canvasContext, viewport }).promise;
        const result = await worker.recognize(canvas);
        ocrPages.push(result.data.text);
        onProgress({ stage: `OCR page ${pageNumber}`, progress: pageNumber / pdf.numPages });
      }
    } finally {
      await worker.terminate();
    }
    return ocrPages.join("\n\n").trim();
  }
  if (file.type.startsWith("image/")) {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", undefined, {
      logger: (message) => {
        if (message.status) onProgress({ stage: message.status, progress: message.progress ?? 0 });
      }
    });
    try {
      const result = await worker.recognize(file);
      return result.data.text.trim();
    } finally {
      await worker.terminate();
    }
  }
  throw new Error("Use a PDF, image, or text file.");
}
