import { readFileSync, writeFileSync } from "node:fs";
import { startDemo, type Scenario } from "../src/demo.js";
import { WebSurface, defaultPolicy } from "../src/surface.js";
import { Evidence } from "../src/evidence.js";
import { Engine } from "../src/engine.js";
import { Handoff } from "../src/operator.js";
const artifact = JSON.parse(readFileSync("evidence/capability.json", "utf8"));
const index: unknown[] = [];
for (const scenario of [
  "normal",
  "not_found",
  "interstitial",
  "slow",
  "app_error",
  "dialog",
  "expired",
] as Scenario[]) {
  const demo = await startDemo(scenario);
  const surface = await WebSurface.open(demo.url);
  const evidence = new Evidence(`evidence/${scenario}`, "replay");
  const handoff = new Handoff(
    surface,
    defaultPolicy,
    evidence,
    scenario === "expired",
    async ({ url, token }) => {
      evidence.event("operator_test_driver", {
        simulatedHuman: true,
        description:
          "Automated driver exercises real control-transfer endpoint; not a human-operated run.",
      });
      const send = (path: string, body: unknown) =>
        fetch(url + path, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      if (
        !(
          await send("/act", {
            kind: "click",
            target: "restore",
            parameter: null,
            reason: "open_record",
          })
        ).ok
      )
        throw new Error("restore_failed");
      if (!(await send("/resume", {})).ok) throw new Error("resume_failed");
    },
  );
  try {
    const result = await new Engine(
      surface,
      defaultPolicy,
      evidence,
      handoff,
    ).replay(artifact, { memberId: "54321" });
    index.push({
      scenario,
      status: result.status,
      evidence: evidence.dir.replaceAll("\\", "/"),
      simulatedHuman: scenario === "expired",
    });
    console.log(scenario, result.status);
    const expected = ["app_error", "dialog"].includes(scenario)
      ? "failure"
      : scenario === "not_found"
        ? "business_outcome"
        : "success";
    if (result.status !== expected) throw new Error("unexpected_result");
  } finally {
    await surface.close();
    await demo.close();
  }
}
writeFileSync("evidence/replay-index.json", JSON.stringify(index, null, 2));
