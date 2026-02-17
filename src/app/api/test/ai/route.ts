import { routeAI } from "@/lib/ai/router";
import type { ChatParams } from "@/lib/ai/providers/types";

export async function GET() {
  try {
    const params: ChatParams = {
      messages: [{ role: "user", content: "Say hello in exactly 5 words" }],
      model: "flash",
    };

    const response = await routeAI("chat", params);

    return Response.json({
      success: true,
      response: response.content,
      tokens: response.tokensUsed,
      cost: response.costInr,
      model: response.modelUsed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
