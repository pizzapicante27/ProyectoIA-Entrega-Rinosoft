import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import express from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE_LENGTH = 2000;

export function createApp(openAIClient, agentName) {
  const app = express();
  const publicDirectory = resolve(import.meta.dirname, "public");

  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/api/chat", async (request, response) => {
    const { message, conversation_id: conversationId } = request.body ?? {};

    if (
      typeof message !== "string" ||
      message.trim().length === 0 ||
      message.length > MAX_MESSAGE_LENGTH
    ) {
      response.status(422).json({
        error: "El mensaje debe tener entre 1 y 2000 caracteres.",
      });
      return;
    }

    if (
      conversationId !== undefined &&
      (typeof conversationId !== "string" || conversationId.trim().length === 0)
    ) {
      response.status(422).json({ error: "El identificador de conversación no es válido." });
      return;
    }

    try {
      const userMessage = {
        type: "message",
        role: "user",
        content: message.trim(),
      };
      const conversation = conversationId
        ? { id: conversationId }
        : await openAIClient.conversations.create({ items: [userMessage] });

      if (conversationId) {
        await openAIClient.conversations.items.create(conversation.id, {
          items: [userMessage],
        });
      }

      const agentReference = {
        body: {
          agent_reference: { name: agentName, type: "agent_reference" },
        },
      };
      const result = await openAIClient.responses.create(
        { conversation: conversation.id },
        agentReference,
      );

      if (typeof result.output_text !== "string" || result.output_text.trim().length === 0) {
        throw new Error("Foundry returned an empty response.");
      }

      response.json({
        reply: result.output_text,
        conversation_id: conversation.id,
      });
    } catch (error) {
      const errorName = typeof error?.name === "string" ? error.name : "Error";
      const httpStatus = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : Number.isInteger(error?.status)
          ? error.status
          : null;
      const errorCode =
        typeof error?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
          ? error.code
          : null;
      const diagnostics = [
        errorName,
        ...(httpStatus ? [`HTTP ${httpStatus}`] : []),
        ...(errorCode ? [`code=${errorCode}`] : []),
      ];
      console.error(`Falló una solicitud a Microsoft Foundry (${diagnostics.join(", ")}).`);
      response.status(502).json({
        error: "No se pudo obtener una respuesta. Inténtalo de nuevo.",
      });
    }
  });

  app.use(express.static(publicDirectory));

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error.type === "entity.parse.failed") {
      response.status(400).json({ error: "El cuerpo de la solicitud no es JSON válido." });
      return;
    }

    if (error.type === "entity.too.large") {
      response.status(413).json({ error: "El cuerpo de la solicitud es demasiado grande." });
      return;
    }

    console.error("Error inesperado en el servidor:", error);
    response.status(500).json({ error: "Ocurrió un error interno." });
  });

  return app;
}

function getRequiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta configurar la variable de entorno ${name}.`);
  }
  return value;
}

function startServer() {
  const endpoint = getRequiredEnvironmentVariable("FOUNDRY_PROJECT_ENDPOINT");
  const agentName = getRequiredEnvironmentVariable("FOUNDRY_AGENT_NAME");
  const port = Number(process.env.PORT || 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("La variable PORT debe ser un puerto válido.");
  }

  const projectClient = new AIProjectClient(endpoint, new DefaultAzureCredential());
  const openAIClient = projectClient.getOpenAIClient();
  const app = createApp(openAIClient, agentName);
  const server = app.listen(port, () => {
    console.info(`Servidor escuchando en el puerto ${port}.`);
  });

  server.on("error", (error) => {
    console.error("No se pudo iniciar el servidor:", error.message);
    process.exitCode = 1;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    startServer();
  } catch (error) {
    console.error("No se pudo iniciar el servidor:", error.message);
    process.exitCode = 1;
  }
}
