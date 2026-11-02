// Crea (o actualiza) el agente de Microsoft Foundry que usará el chatbot.
// Ejecuta una sola vez: npm run create-agent (requiere az login y el archivo .env)
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
const ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT;
const AGENT_NAME = process.env.FOUNDRY_AGENT_NAME ?? "asistente-web";
const MODEL = process.env.FOUNDRY_MODEL_DEPLOYMENT ?? "gpt-5-mini";
const INSTRUCTIONS = `Eres el asistente virtual de este sitio web.
Respondes en español, de forma breve (máximo 4 párrafos) y amable.
Si no sabes algo, dilo con honestidad y sugiere dónde buscar.
No inventes precios, fechas ni datos de contacto.`;
const project = new AIProjectClient(ENDPOINT, new DefaultAzureCredential());
const agent = await project.agents.createVersion(AGENT_NAME, {
  kind: "prompt",
model: MODEL,
instructions: INSTRUCTIONS,
});
console.log(`Agente listo -> nombre: ${agent.name}, versión: ${agent.version}`);