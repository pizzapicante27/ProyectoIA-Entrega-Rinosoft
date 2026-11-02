const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const sendBtn = document.getElementById("send-button");
const messages = document.getElementById("messages");
const status = document.getElementById("form-status");
const characterCount = document.getElementById("character-count");
let conversationId = null; // se reinicia al recargar la página

function addMessage(text, who) {
  const row = document.createElement("li");
  row.classList.add("message-row", who === "user" ? "user-row" : "assistant-row");
  if (who === "error") {
    row.classList.add("error-row");
  } else if (who === "typing") {
    row.classList.add("typing-row");
  }

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = who === "user" ? "T" : "A";

  const content = document.createElement("div");
  content.className = "message-content";
  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = who === "user" ? "Tú" : "Asistente";

  const bubble = document.createElement("p");
  bubble.className = "message-bubble";
  bubble.textContent = text;

  content.append(author, bubble);
  row.append(avatar, content);
  messages.append(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return row;
}

input.addEventListener("input", () => {
  characterCount.textContent = `${input.value.length} / 2000`;
  status.textContent = "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    status.textContent = "Escribe un mensaje antes de enviar.";
    input.focus();
    return;
  }

  addMessage(text, "user");
  input.value = "";
  characterCount.textContent = "0 / 2000";
  status.textContent = "";
  sendBtn.disabled = true;
  input.disabled = true;
  const typing = addMessage("Escribiendo…", "typing");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.detail || "Error del servidor.");
    }

    if (typeof data.reply !== "string" || typeof data.conversation_id !== "string") {
      throw new Error("El servidor devolvió una respuesta no válida.");
    }

    conversationId = data.conversation_id;
    typing.remove();
    addMessage(data.reply, "assistant");
  } catch (error) {
    typing.remove();
    const message =
      error instanceof TypeError
        ? "No se pudo conectar con el servidor. Inténtalo de nuevo."
        : error.message;
    addMessage(`Ups: ${message}`, "error");
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
});