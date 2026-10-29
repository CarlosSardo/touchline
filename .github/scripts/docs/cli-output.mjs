const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_FINAL_BYTES = 8 * 1024 * 1024;

export function finalCheckerResponse(output) {
  if (typeof output !== "string" || Buffer.byteLength(output) > MAX_STREAM_BYTES) {
    throw new Error("Checker event stream exceeds its byte limit");
  }
  const lines = output.trim().split("\n");
  let finalMessage = null;
  let completed = false;
  let assistantMessages = 0;
  let toolResults = 0;
  let pendingDelta = false;
  for (let index = 0; index < lines.length; index += 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      throw new Error(`Checker event stream has malformed JSONL at record ${index + 1}`);
    }
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        typeof event.type !== "string" || completed) {
      throw new Error(`Checker event stream has an invalid envelope at record ${index + 1}`);
    }
    if (event.type === "session.error") throw new Error("Checker session reported an error");
    if (event.type === "assistant.message_delta") pendingDelta = true;
    if (event.type === "assistant.message") {
      const data = event.data;
      if (!data || typeof data.content !== "string" ||
          (data.toolRequests !== undefined && !Array.isArray(data.toolRequests))) {
        throw new Error("Checker assistant message is malformed");
      }
      finalMessage = data;
      pendingDelta = false;
      assistantMessages += 1;
    }
    if (event.type === "tool.execution_complete") toolResults += 1;
    if (event.type === "result") {
      if (event.exitCode !== 0 || pendingDelta || !finalMessage || !finalMessage.content.trim() ||
          (finalMessage.toolRequests?.length ?? 0) !== 0) {
        throw new Error("Checker did not finish with a successful complete final response");
      }
      completed = true;
    }
  }
  if (!completed) throw new Error("Checker event stream is missing its terminal result");
  const content = finalMessage.content.trim();
  if (Buffer.byteLength(content) > MAX_FINAL_BYTES) throw new Error("Checker final response exceeds its byte limit");
  return { content, records: lines.length, assistantMessages, toolResults };
}
