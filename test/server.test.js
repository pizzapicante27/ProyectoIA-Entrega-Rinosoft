import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { runInNewContext } from "node:vm";
import { createApp } from "../server.js";

const responseCalls = [];
const conversationCreateCalls = [];
const conversationItemCalls = [];
let conversationCount = 0;
let failResponses = false;
const openAIClient = {
  conversations: {
    async create(request) {
      conversationCount += 1;
      conversationCreateCalls.push(request);
      return { id: `conversation-${conversationCount}` };
    },
    items: {
      async create(conversationId, request) {
        conversationItemCalls.push({ conversationId, request });
      },
    },
  },
  responses: {
    async create(request, agentReference) {
      if (failResponses) {
        throw new Error("Sensitive upstream diagnostic details.");
      }
      responseCalls.push({ request, agentReference });
      return { output_text: "Respuesta de prueba" };
    },
  },
};

let server;
let baseUrl;

before(async () => {
  const app = createApp(openAIClient, "test-assistant");
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("health endpoint responds with ok", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("empty and whitespace-only messages are rejected with 422", async () => {
  for (const message of ["", "   "]) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 422);
  }
});

test("multi-turn requests preserve the conversation and use the configured agent", async () => {
  responseCalls.length = 0;
  conversationCreateCalls.length = 0;
  conversationItemCalls.length = 0;
  const firstResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Primera pregunta" }),
  });
  const firstResult = await firstResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(firstResult.conversation_id, `conversation-${conversationCount}`);
  assert.equal(firstResult.reply, "Respuesta de prueba");
  assert.deepEqual(conversationCreateCalls, [
    {
      items: [
        {
          type: "message",
          role: "user",
          content: "Primera pregunta",
        },
      ],
    },
  ]);

  const followUpResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "¿Y qué significa?",
      conversation_id: firstResult.conversation_id,
    }),
  });
  const followUpResult = await followUpResponse.json();

  assert.equal(followUpResponse.status, 200);
  assert.equal(followUpResult.conversation_id, firstResult.conversation_id);
  assert.equal(responseCalls.length, 2);
  assert.deepEqual(
    responseCalls.map(({ request }) => request),
    [
      { conversation: firstResult.conversation_id },
      { conversation: firstResult.conversation_id },
    ],
  );
  assert.deepEqual(conversationItemCalls, [
    {
      conversationId: firstResult.conversation_id,
      request: {
        items: [
          {
            type: "message",
            role: "user",
            content: "¿Y qué significa?",
          },
        ],
      },
    },
  ]);
  assert.deepEqual(responseCalls[0].agentReference, {
    body: {
      agent_reference: { name: "test-assistant", type: "agent_reference" },
    },
  });
});

test("messages longer than 2000 characters are rejected with 422", async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(2001) }),
  });
  assert.equal(response.status, 422);
});

test("Foundry errors return a generic 502 response", async () => {
  failResponses = true;
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Pregunta de prueba" }),
    });
    const result = await response.json();

    assert.equal(response.status, 502);
    assert.deepEqual(result, {
      error: "No se pudo obtener una respuesta. Inténtalo de nuevo.",
    });
    assert.equal(JSON.stringify(result).includes("Sensitive"), false);
  } finally {
    failResponses = false;
  }
});

test("frontend renders assistant messages with textContent and not innerHTML", async () => {
  const [frontend, html] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="message-input"/);
  assert.match(html, /id="send-button"/);
  assert.match(frontend, /getElementById\("message-input"\)/);
  assert.match(frontend, /getElementById\("send-button"\)/);
  assert.match(frontend, /bubble\.textContent\s*=\s*text/);
  assert.doesNotMatch(frontend, /\.innerHTML\b/);
});

test("chat form sends messages and reuses the conversation id", async () => {
  const frontend = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const elements = new Map();
  const requests = [];

  function createElement() {
    return {
      children: [],
      handlers: {},
      classList: { add() {} },
      append(...children) {
        this.children.push(...children);
      },
      addEventListener(eventName, handler) {
        this.handlers[eventName] = handler;
      },
      focus() {},
      remove() {},
      scrollIntoView() {},
      setAttribute() {},
    };
  }

  for (const id of ["chat-form", "message-input", "send-button", "messages", "form-status", "character-count"]) {
    elements.set(id, createElement());
  }
  elements.get("messages").scrollHeight = 0;

  const fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      async json() {
        return {
          reply: "Respuesta de prueba.",
          conversation_id: "conversation-test",
        };
      },
    };
  };

  runInNewContext(frontend, {
    document: {
      createElement,
      getElementById: (id) => elements.get(id) ?? null,
    },
    fetch,
  });

  const form = elements.get("chat-form");
  const submit = form.handlers?.submit;
  assert.equal(typeof submit, "function");

  for (const message of ["Primera pregunta", "Seguimiento"]) {
    elements.get("message-input").value = message;
    await submit({ preventDefault() {} });
  }

  assert.deepEqual(requests, [
    { message: "Primera pregunta" },
    { message: "Seguimiento", conversation_id: "conversation-test" },
  ]);
});
