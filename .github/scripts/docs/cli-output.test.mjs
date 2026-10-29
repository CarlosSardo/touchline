import assert from "node:assert/strict";
import test from "node:test";
import { finalCheckerResponse } from "./cli-output.mjs";

const message = (content, toolRequests = []) => ({
  type: "assistant.message", data: { content, toolRequests },
});
const result = { type: "result", exitCode: 0 };
const stream = (...events) => events.map((event) => JSON.stringify(event)).join("\n");

test("Copilot JSONL selects the final complete response, never concatenated progress or tool output", () => {
  const report = '{"schemaVersion":1,"claims":[{"status":"supported"}]}';
  const output = stream(
    { type: "session.start", data: { sessionId: "fixture" } },
    message('{"progress":"Reading source"}', [{ name: "view", arguments: { path: "README.md" } }]),
    { type: "tool.execution_complete", data: { result: { content: "PRIVATE_SOURCE_FIXTURE" } } },
    { type: "assistant.message_delta", data: { deltaContent: "NOT_AN_AUTHORITATIVE_RESPONSE" } },
    message(report),
    { type: "session.shutdown", data: {} },
    result,
  );
  assert.deepEqual(finalCheckerResponse(output), {
    content: report, records: 7, assistantMessages: 2, toolResults: 1,
  });
});

test("missing, failed, duplicate or interrupted final records fail closed", () => {
  for (const output of [
    stream(message("{}")),
    stream(message("{}"), { ...result, exitCode: 1 }),
    stream(message("{}"), result, result),
    stream(message("{}"), result, message("{}")),
    stream(message("{}"), { type: "assistant.message_delta", data: { deltaContent: "PRIVATE_INCOMPLETE" } }, result),
    stream(message("{}"), { type: "session.error", data: { message: "PRIVATE_ERROR" } }, result),
    stream(message("", [{ name: "view" }]), result),
    stream(message("{}", [{ name: "view" }]), result),
    stream({ type: "assistant.message", data: { content: null } }, result),
    stream({ type: "assistant.message", data: { content: "{}", toolRequests: "bad" } }, result),
    `${stream(message("{}"))}\nPRIVATE_NOISE\n${stream(result)}`,
    '{"type":"assistant.message","data":{"content":"PRIVATE_INCOMPLETE',
    stream(result),
    "{}",
    "",
  ]) {
    assert.throws(() => finalCheckerResponse(output), (error) => {
      assert.doesNotMatch(error.message, /PRIVATE|NOISE/);
      return true;
    });
  }
});

test("transport does not repair malformed model JSON or accept an earlier passing object", () => {
  const response = finalCheckerResponse(stream(message('{"claims":[]}'), message('{"claims":'), result));
  assert.equal(response.content, '{"claims":');
  assert.throws(() => JSON.parse(response.content), SyntaxError);
  const mixed = finalCheckerResponse(stream(message('{}\nHere is a summary'), result));
  assert.throws(() => JSON.parse(mixed.content), SyntaxError);
});
