import { rgb } from "pdf-lib";

import {
  COLORS,
  createPDFBuilder,
  extractDiagramBlocks,
  fetchMermaidAsPng,
  svgCodeToPngBytes,
} from "@/lib/pdf/builder";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await request.json();

    const adminClient = createAdminClient();

    // Verify session ownership
    const { data: session } = await adminClient
      .from("chat_sessions")
      .select("id, created_at, subjects(name, code)")
      .eq("id", sessionId)
      .eq("student_id", user.id)
      .single();

    if (!session) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch messages
    const { data: messages } = await adminClient
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (!messages?.length) {
      return Response.json({ error: "No messages" }, { status: 404 });
    }

    const subjectName = (session.subjects as any)?.name ?? "Unknown Subject";
    const subjectCode = (session.subjects as any)?.code ?? "";
    const dateStr = new Date(session.created_at).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const { builder } = await createPDFBuilder();

    // Header
    builder.addPageHeader(
      `Chat Export — ${subjectCode}`,
      subjectName,
      `${dateStr} · ${messages.length} messages`
    );

    // Messages
    for (const msg of messages as {
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }[]) {
      const time = new Date(msg.created_at).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (msg.role === "user") {
        builder.space(8);
        builder.ensureSpace(40);

        // "You" label with time
        builder.text(`You  ·  ${time}`, {
          font: builder.getFont("bold"),
          size: 10,
          color: rgb(0.145, 0.388, 0.922), // primary
        });
        builder.space(2);

        // User message in a light box
        const endCard = builder.beginCard(
          rgb(0.937, 0.949, 0.996), // very light blue
          rgb(0.145, 0.388, 0.922)
        );
        builder.text(msg.content, { size: 11 });
        endCard();
        builder.space(8);
      } else {
        builder.space(4);

        // "EduNexus AI" label with time
        builder.text(`EduNexus AI  ·  ${time}`, {
          font: builder.getFont("bold"),
          size: 10,
          color: rgb(0.086, 0.639, 0.29), // success green
        });
        builder.space(2);

        // AI response with full markdown rendering + Mermaid diagrams
        const endCard = builder.beginCard(
          rgb(0.973, 0.988, 0.973), // very light green
          rgb(0.086, 0.639, 0.29)
        );
        const parts = extractDiagramBlocks(msg.content);
        for (const part of parts) {
          if (part.type === "text") {
            if (part.content.trim()) {
              builder.markdown(part.content, 11);
            }
          } else if (part.type === "mermaid") {
            const pngBytes = await fetchMermaidAsPng(part.content);
            if (pngBytes) {
              await builder.addImage(pngBytes, "Diagram");
            } else {
              builder.text("[Diagram — open in EduNexus AI to view]", {
                size: 10,
                color: COLORS.light,
              });
              builder.space(4);
            }
          } else {
            const pngBytes = await svgCodeToPngBytes(part.content);
            if (pngBytes) {
              await builder.addImage(pngBytes, "Diagram");
            } else {
              builder.text("[Diagram — open in EduNexus AI to view]", {
                size: 10,
                color: COLORS.light,
              });
              builder.space(4);
            }
          }
        }
        endCard();
        builder.space(10);
      }
    }

    const pdfBytes = await builder.build();
    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="chat-${subjectCode}-export.pdf"`,
      },
    });
  } catch (err) {
    console.error("[chat/export]", err);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}

