import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, readEnvironment } from "../src/config.js";
import { OpenAIDecider } from "../src/model.js";
import { Evidence } from "../src/evidence.js";

test("dotenv settings support quoted values and comments", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "dotenv-test-")), ".env");
  writeFileSync(
    filePath,
    '# local settings\nOPENAI_API_KEY="file-credential"\nOPENAI_MODEL=local-model # comment\nOPENAI_TIMEOUT_MS=120000\n',
  );
  const config = loadConfig(readEnvironment(filePath, {}));
  assert.equal(config.openai.apiKey, "file-credential");
  assert.equal(config.openai.model, "local-model");
  assert.equal(config.openai.timeoutMs, 120000);
});

test("terminal settings override dotenv without modifying the supplied environment", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "dotenv-test-")), ".env");
  writeFileSync(
    filePath,
    "OPENAI_API_KEY=file-credential\nOPENAI_MODEL=local-model\n",
  );
  const environment = {
    OPENAI_API_KEY: "terminal-credential",
    OPENAI_MODEL: undefined,
  };
  const merged = readEnvironment(filePath, environment);
  assert.equal(merged.OPENAI_API_KEY, "terminal-credential");
  assert.equal(merged.OPENAI_MODEL, "local-model");
  assert.equal(environment.OPENAI_MODEL, undefined);
  assert.ok(Object.isFrozen(merged));
  assert.equal(
    loadConfig(readEnvironment(filePath, { OPENAI_API_KEY: "" })).openai.apiKey,
    undefined,
  );
});

test("missing dotenv is optional but unreadable files fail with a safe message", () => {
  const directory = mkdtempSync(join(tmpdir(), "dotenv-test-"));
  assert.equal(
    loadConfig(readEnvironment(join(directory, "missing.env"), {})).openai
      .apiKey,
    undefined,
  );
  assert.throws(() => readEnvironment(directory, {}), {
    message: "Unable to load the .env configuration file.",
  });
});

test("dotenv values pass through config validation", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "dotenv-test-")), ".env");
  writeFileSync(filePath, "OPENAI_TIMEOUT_MS=not-a-number\n");
  assert.throws(
    () => loadConfig(readEnvironment(filePath, {})),
    /Invalid OpenAI configuration/,
  );
});

test("configuration has immutable defaults and permits keyless offline execution", () => {
  const config = loadConfig({});
  assert.deepEqual(config.openai, {
    apiKey: undefined,
    model: "gpt-4.1-mini",
    timeoutMs: 60_000,
    maxOutputTokens: 400,
  });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.openai));
});

test("configuration snapshots supplied settings without mutating its source", () => {
  const environment = {
    OPENAI_API_KEY: " test-credential ",
    OPENAI_MODEL: "custom-model",
    OPENAI_TIMEOUT_MS: "120000",
  };
  const config = loadConfig(environment);
  assert.equal(config.openai.apiKey, "test-credential");
  assert.equal(config.openai.model, "custom-model");
  assert.equal(config.openai.timeoutMs, 120_000);
  assert.equal(environment.OPENAI_API_KEY, " test-credential ");
  environment.OPENAI_MODEL = "changed-model";
  assert.equal(config.openai.model, "custom-model");
  assert.equal(loadConfig({ OPENAI_API_KEY: "  " }).openai.apiKey, undefined);
});

test("invalid configuration fails without exposing supplied values", () => {
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "180001"]) {
    assert.throws(
      () => loadConfig({ OPENAI_TIMEOUT_MS: value }),
      /Invalid OpenAI configuration/,
    );
  }
  const sensitiveValue = "private-value".repeat(20);
  assert.throws(
    () => loadConfig({ OPENAI_MODEL: sensitiveValue }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(sensitiveValue));
      return true;
    },
  );
});

test("model consumes injected configuration and does not log credentials", async (t) => {
  const evidence = new Evidence(
    mkdtempSync(join(tmpdir(), "config-test-")),
    "openai",
  );
  const config = loadConfig({
    OPENAI_API_KEY: "test-credential",
    OPENAI_MODEL: "injected-model",
    OPENAI_TIMEOUT_MS: "1000",
  });
  const action = {
    kind: "read",
    target: "balance",
    parameter: null,
    reason: "read_balance",
  };
  const request = t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-credential",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "injected-model");
      assert.equal(body.max_output_tokens, config.openai.maxOutputTokens);
      assert.equal(body.store, false);
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json({
        id: "test-response",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(action) }],
          },
        ],
      });
    },
  );
  const model = new OpenAIDecider(evidence, config.openai);
  assert.deepEqual(
    await model.decide(
      "read balance",
      { state: "details", controls: ["balance"], frame: "Workspace" },
      [],
    ),
    action,
  );
  assert.equal(request.mock.callCount(), 1);
  assert.ok(
    !readFileSync(join(evidence.dir, "events.jsonl"), "utf8").includes(
      "test-credential",
    ),
  );
  assert.throws(
    () => new OpenAIDecider(evidence, loadConfig({}).openai),
    /missing_api_key/,
  );
});
