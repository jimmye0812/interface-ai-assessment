import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Observation } from "./surface.js";
import type { Result } from "./schema.js";
export class Evidence {
  readonly runId = randomUUID();
  readonly dir: string;
  constructor(
    root: string,
    public mode: "openai" | "fixture" | "replay",
  ) {
    this.dir = join(root, this.runId);
    mkdirSync(this.dir, { recursive: true });
    this.event("start", { mode });
  }
  // Call sites pass only enums, indices, schema-validated steps and provider IDs.
  event(event: string, data: Record<string, unknown> = {}) {
    appendFileSync(
      join(this.dir, "events.jsonl"),
      JSON.stringify({
        time: new Date().toISOString(),
        runId: this.runId,
        event,
        ...data,
      }) + "\n",
    );
  }
  snapshot(observation: Observation) {
    writeFileSync(
      join(this.dir, "failure-structure.json"),
      JSON.stringify(observation, null, 2),
    );
  }
  result(result: Result) {
    const safe =
      result.status === "success"
        ? { ...result, outputs: { balance: "[REDACTED]" } }
        : result;
    writeFileSync(join(this.dir, "result.json"), JSON.stringify(safe, null, 2));
    this.event("complete", { status: result.status });
  }
}
