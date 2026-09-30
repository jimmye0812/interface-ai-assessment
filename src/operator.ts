import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Surface, Policy, Observation } from "./surface.js";
import { Stop } from "./surface.js";
import { Action } from "./schema.js";
import type { Evidence } from "./evidence.js";

const operatorPage = readFileSync(
  new URL("./pages/operator.html", import.meta.url),
  "utf8",
);

export type Intervention = {
  code: string;
  step: number;
  expected?: string;
  observation: Observation;
};
export type OperatorHandle = { url: string; token: string };
export class Handoff {
  owner: "automation" | "human" | "closed" = "automation";
  constructor(
    private surface: Surface,
    private policy: Policy,
    private evidence: Evidence,
    private enabled: boolean,
    private onReady?: (handle: OperatorHandle) => Promise<void>,
  ) {}
  async request(request: Intervention): Promise<void> {
    this.evidence.event("intervention_requested", {
      ...request,
      capability: "savings-review",
    });
    this.evidence.snapshot(request.observation);
    if (!this.enabled) throw new Stop("intervention_required");
    if (this.owner !== "automation") throw new Stop("invalid_control_owner");
    this.owner = "human";
    this.evidence.event("control_transferred", { owner: "human" });
    const token = randomBytes(24).toString("hex");
    let busy = false;
    let settled = false;
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const completion = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const server = createServer(async (req, res) => {
      const json = (status: number, value: unknown) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(value));
      };
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        });
        return res.end(operatorPage);
      }
      const origin = req.headers.origin;
      const address = server.address() as { port: number };
      if (
        req.method !== "POST" ||
        req.headers.authorization !== `Bearer ${token}` ||
        (origin && origin !== `http://127.0.0.1:${address.port}`)
      )
        return json(403, { error: "unauthorized" });
      if (this.owner !== "human" || busy || settled)
        return json(409, { error: "control_unavailable" });
      busy = true;
      try {
        const body = await readBody(req);
        if (req.url === "/state")
          return json(200, {
            ...request,
            current: await this.surface.observe(),
            owner: this.owner,
          });
        if (req.url === "/act") {
          const action = Action.parse(body);
          await this.surface.act(action, { memberId: "" }, true);
          const observed = await this.surface.settle();
          this.evidence.event("human_action", { action, observed });
          return json(200, observed);
        }
        if (req.url === "/resume") {
          const observation = await this.surface.settle();
          if (
            ["expired", "unknown", "app_error", "loading"].includes(
              observation.state,
            )
          )
            return json(409, { error: "state_not_resumable", observation });
          settled = true;
          this.owner = "automation";
          this.evidence.event("control_transferred", {
            owner: "automation",
            observation,
          });
          json(200, { owner: this.owner });
          resolve();
          return;
        }
        if (req.url === "/abort") {
          settled = true;
          json(200, { status: "aborted" });
          reject(new Stop("human_aborted"));
          return;
        }
        json(404, { error: "unknown_command" });
      } catch {
        json(400, { error: "operator_action_rejected" });
      } finally {
        busy = false;
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const handle = { url: `http://127.0.0.1:${port}`, token };
    // Token is displayed interactively only, never written to evidence.
    if (!this.onReady)
      process.stderr.write(`Operator takeover: ${handle.url}/#${token}\n`);
    const timeout = setTimeout(
      () => reject(new Stop("handoff_timeout")),
      this.policy.handoffTimeoutMs,
    );
    try {
      if (this.onReady)
        void this.onReady(handle).catch(() =>
          reject(new Stop("operator_driver_failed")),
        );
      await completion;
    } finally {
      clearTimeout(timeout);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      if (this.owner === "human") this.owner = "closed";
    }
  }
}
async function readBody(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error("body_limit");
  }
  return JSON.parse(text || "{}");
}
