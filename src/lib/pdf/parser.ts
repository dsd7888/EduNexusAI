import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// Disable worker (causes issues in Next.js)
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

function cleanExtractedText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTextFromPDF(
  fileBuffer: ArrayBuffer
): Promise<string> {
  try {
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(fileBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const textParts: string[] = [];

    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = (textContent.items as any[])
        .map((item: any) => item.str)
        .join(" ");

      textParts.push(pageText);
    }

    const fullText = textParts.join("\n\n");
    return cleanExtractedText(fullText);
  } catch (error) {
    console.error("[PDF Parser] Error:", error);
    throw new Error(
      `Failed to extract text from PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

