import { createAdminClient } from "@/lib/db/supabase-server";
import { getGeminiProvider } from "@/lib/ai/providers/gemini";
import { extractTextFromPDF } from "@/lib/pdf/parser";
import { chunkText } from "@/lib/pdf/chunker";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function embedDocument(documentId: string): Promise<void> {
  const adminClient = createAdminClient();
  const gemini = getGeminiProvider();

  const fail = async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[embedDocument] failed:", { documentId, message });
    try {
      await adminClient
        .from("documents")
        .update({ status: "failed" })
        .eq("id", documentId);
    } catch (statusErr) {
      console.error("[embedDocument] failed to update status:", statusErr);
    }
    throw error instanceof Error ? error : new Error(message);
  };

  try {
    console.log("[embedDocument] start:", { documentId });

    const { data: document, error: docError } = await adminClient
      .from("documents")
      .select("id, file_path")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      throw new Error(docError?.message ?? "Document not found");
    }

    console.log("[embedDocument] downloading:", { file_path: document.file_path });

    const { data: fileBlob, error: downloadError } = await adminClient.storage
      .from("documents")
      .download(document.file_path);

    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message ?? "Failed to download PDF");
    }

    const fileBuffer = await fileBlob.arrayBuffer();

    console.log("[embedDocument] extracting text");
    const text = await extractTextFromPDF(fileBuffer);
    console.log("[embedDocument] extracted:", { chars: text.length });

    console.log("[embedDocument] chunking");
    const chunks = chunkText(text);
    console.log("[embedDocument] chunks:", { count: chunks.length });

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const embedding = await gemini.embed(chunk.content);

      const pageNumber = Math.floor(chunk.startChar / 2000);

      const { error: insertError } = await adminClient
        .from("document_chunks")
        .insert({
          document_id: documentId,
          content: chunk.content,
          page_number: pageNumber,
          chunk_index: chunk.index,
          embedding,
          metadata: {
            char_start: chunk.startChar,
            char_end: chunk.endChar,
          },
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      if ((i + 1) % 10 === 0) {
        console.log("[embedDocument] progress:", {
          documentId,
          done: i + 1,
          total: chunks.length,
        });
      }

      await sleep(100);
    }

    await adminClient
      .from("documents")
      .update({ status: "ready" })
      .eq("id", documentId);

    console.log("[embedDocument] done:", { documentId });
  } catch (err) {
    await fail(err);
  }
}

export async function embedChunks(chunks: string[]) {
  return chunks.map(() => new Float32Array(0));
}
