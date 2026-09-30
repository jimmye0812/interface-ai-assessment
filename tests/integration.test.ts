import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDemo, type Scenario } from "../src/demo.js";
import {
  WebSurface,
  defaultPolicy,
  authorize,
  permittedUrl,
} from "../src/surface.js";
import { Evidence } from "../src/evidence.js";
import { Handoff, type OperatorHandle } from "../src/operator.js";
import { Engine } from "../src/engine.js";
import { FixtureDecider } from "../src/model.js";
import { Artifact } from "../src/schema.js";
const root = mkdtempSync(join(tmpdir(), "capability-tests-"));
async function session<T>(
  scenario: Scenario,
  fn: (s: WebSurface, e: Evidence, h: Handoff) => Promise<T>,
  operator?: (h: OperatorHandle) => Promise<void>,
) {
  const demo = await startDemo(scenario);
  let surface: WebSurface | undefined;
  const evidence = new Evidence(root, "fixture");
  try {
    surface = await WebSurface.open(demo.url);
    return await fn(
      surface,
      evidence,
      new Handoff(surface, defaultPolicy, evidence, !!operator, operator),
    );
  } finally {
    await surface?.close();
    await demo.close();
  }
}
let artifact: Artifact;
test("discover a reusable fixture against real Chromium; replay uses changed input", async () => {
  artifact = await session("normal", async (s, e, h) => {
    const { result, artifact } = await new Engine(
      s,
      defaultPolicy,
      e,
      h,
    ).discover(
      "read balance and review",
      { memberId: "12345" },
      new FixtureDecider(),
    );
    assert.equal(result.status, "success");
    assert.ok(artifact);
    return artifact;
  });
  await session("normal", async (s, e, h) => {
    const result = await new Engine(s, defaultPolicy, e, h).replay(artifact, {
      memberId: "54321",
    });
    assert.equal(result.status, "success");
    if (result.status === "success")
      assert.equal(result.outputs.balance, "842.10");
    const logs =
      readFileSync(join(e.dir, "events.jsonl"), "utf8") +
      readFileSync(join(e.dir, "result.json"), "utf8");
    assert.ok(!logs.includes("54321"));
    assert.ok(!logs.includes("842.10"));
  });
});
for (const scenario of [
  "not_found",
  "validation",
  "denied",
  "interstitial",
  "slow",
  "app_error",
  "dialog",
  "expired",
] as Scenario[]) {
  test(`replay handles ${scenario}`, async () =>
    session(scenario, async (s, e, h) => {
      const result = await new Engine(s, defaultPolicy, e, h).replay(artifact, {
        memberId: "12345",
      });
      if (["not_found", "validation", "denied"].includes(scenario)) {
        assert.equal(result.status, "business_outcome");
        if (result.status === "business_outcome")
          assert.equal(result.code, scenario);
      } else if (["slow", "interstitial"].includes(scenario))
        assert.equal(result.status, "success");
      else {
        assert.equal(result.status, "failure");
        assert.ok(readdirSync(e.dir).includes("failure-structure.json"));
      }
    }));
}
test("human control restores same page; unauthorized and unsafe commands fail", async () => {
  let pageIdentity: unknown;
  await session(
    "expired",
    async (s, e, h) => {
      pageIdentity = s.page;
      const result = await new Engine(s, defaultPolicy, e, h).replay(artifact, {
        memberId: "12345",
      });
      assert.equal(result.status, "success");
      assert.equal(s.page, pageIdentity);
      assert.equal(h.owner, "automation");
      const logs = readFileSync(join(e.dir, "events.jsonl"), "utf8");
      assert.match(logs, /human_action/);
      assert.match(logs, /control_transferred/);
    },
    async ({ url, token }) => {
      const post = (path: string, body: unknown, auth = token) =>
        fetch(url + path, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      assert.equal((await post("/state", {}, "wrong")).status, 403);
      assert.equal((await post("/resume", {})).status, 409);
      assert.equal(
        (
          await post("/act", {
            kind: "click",
            target: "confirm",
            parameter: null,
            reason: "open_record",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post("/act", {
            kind: "click",
            target: "restore",
            parameter: null,
            reason: "open_record",
          })
        ).status,
        200,
      );
      assert.equal((await post("/resume", {})).status, 200);
    },
  );
});
test("allowlist rejects cross-origin, query exfiltration, irreversible actions", () => {
  assert.equal(
    permittedUrl(
      "http://127.0.0.1:123/workspace",
      "http://127.0.0.1:123",
      defaultPolicy,
    ),
    true,
  );
  for (const url of [
    "https://evil.example/",
    "http://127.0.0.1:123/workspace?secret=x",
    "http://127.0.0.1:123/admin",
  ])
    assert.equal(
      permittedUrl(url, "http://127.0.0.1:123", defaultPolicy),
      false,
    );
  assert.throws(() =>
    authorize(
      {
        kind: "click",
        target: "confirm",
        parameter: null,
        reason: "open_record",
      },
      defaultPolicy,
    ),
  );
});
test("tampered artifact fails before UI mutation", async () =>
  session("normal", async (s, e, h) => {
    const bad = structuredClone(artifact);
    bad.steps.push({
      before: "review",
      after: "review",
      action: {
        kind: "click",
        target: "confirm",
        parameter: null,
        reason: "open_record",
      },
    });
    assert.equal(
      (
        await new Engine(s, defaultPolicy, e, h).replay(bad, {
          memberId: "12345",
        })
      ).status,
      "failure",
    );
    assert.equal((await s.observe()).state, "search");
  }));
test("missing and ambiguous target fail closed", async () =>
  session("normal", async (s) => {
    await s.page
      .frameLocator("iframe")
      .locator("table")
      .evaluate((el) =>
        el.insertAdjacentHTML("beforeend", "<button>Search</button>"),
      );
    await assert.rejects(
      s.act(
        {
          kind: "click",
          target: "search",
          parameter: null,
          reason: "find_record",
        },
        { memberId: "12345" },
      ),
      /ambiguous/,
    );
  }));

test("replay rejects incompatible binding profiles and malformed input before acting", async () =>
  session("normal", async (s, e, h) => {
    const bad = structuredClone(artifact);
    bad.targeting.bindings.search!.value = "Confirm transfer";
    const result = await new Engine(s, defaultPolicy, e, h).replay(bad, {
      memberId: "12345",
    });
    assert.equal(result.status, "failure");
    if (result.status === "failure")
      assert.equal(result.code, "invalid_artifact");
    const inputResult = await new Engine(s, defaultPolicy, e, h).replay(
      artifact,
      { memberId: "invalid" },
    );
    assert.equal(inputResult.status, "failure");
    if (inputResult.status === "failure")
      assert.equal(inputResult.code, "invalid_input");
    assert.equal((await s.observe()).state, "search");
  }));

test("model cannot declare success without the checkpoint and extraction", async () =>
  session("normal", async (s, e, h) => {
    const decider = new FixtureDecider();
    decider.decide = async () => ({
      kind: "finish",
      target: null,
      parameter: null,
      reason: "goal_complete",
    });
    const { result, artifact: saved } = await new Engine(
      s,
      defaultPolicy,
      e,
      h,
    ).discover("finish", { memberId: "12345" }, decider);
    assert.equal(result.status, "failure");
    assert.equal(saved, undefined);
    if (result.status === "failure")
      assert.equal(result.code, "checkpoint_failed");
  }));

test("transient wait has a deadline and does not repeat search", async () =>
  session("slow", async (s, e, h) => {
    s.policy = { ...defaultPolicy, timeoutMs: 100 };
    const result = await new Engine(s, s.policy, e, h).replay(artifact, {
      memberId: "12345",
    });
    assert.equal(result.status, "failure");
    if (result.status === "failure") assert.equal(result.code, "load_timeout");
  }));

test("operator timeout closes ownership and fails without resuming", async () =>
  session("expired", async (s, e) => {
    const policy = { ...defaultPolicy, handoffTimeoutMs: 60 };
    const h = new Handoff(s, policy, e, true, async () => {});
    const result = await new Engine(s, policy, e, h).replay(artifact, {
      memberId: "12345",
    });
    assert.equal(result.status, "failure");
    assert.equal(h.owner, "closed");
    if (result.status === "failure")
      assert.equal(result.code, "handoff_timeout");
  }));

test("browser routing blocks off-origin requests at runtime", async () =>
  session("normal", async (s) => {
    await s.page.evaluate(async () => {
      await fetch("https://blocked.invalid/").catch(() => {});
    });
    await assert.rejects(s.observe(), /network_policy_violation/);
  }));
