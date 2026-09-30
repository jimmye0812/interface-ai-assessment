import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { startDemo, type Scenario } from "./demo.js";
import { WebSurface, defaultPolicy, PolicySchema, Stop } from "./surface.js";
import { Evidence } from "./evidence.js";
import { Engine } from "./engine.js";
import { Handoff } from "./operator.js";
import { FixtureDecider, OpenAIDecider } from "./model.js";

export async function runCli(args: string[], config: AppConfig): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      goal: { type: "string" },
      member: { type: "string", default: "12345" },
      artifact: { type: "string", default: "evidence/capability.json" },
      evidence: { type: "string", default: "runs" },
      scenario: { type: "string", default: "normal" },
      target: { type: "string" },
      policy: { type: "string" },
      fixture: { type: "boolean", default: false },
      operator: { type: "boolean", default: false },
      headed: { type: "boolean", default: false },
      "show-output": { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (!["discover", "replay"].includes(command)) {
    console.error(
      'Usage: npm run demo -- discover|replay [--goal "Look up memberId, read savings balance, reach savings review"] [--member 12345] [--artifact evidence/capability.json] [--fixture] [--operator] [--scenario expired]',
    );
    process.exitCode = 2;
    return;
  }
  const scenarios = [
    "normal",
    "not_found",
    "validation",
    "denied",
    "expired",
    "interstitial",
    "slow",
    "app_error",
    "dialog",
  ];
  if (!scenarios.includes(values.scenario!))
    throw new Error("Invalid scenario");
  const policy = values.policy
    ? PolicySchema.parse(JSON.parse(readFileSync(values.policy, "utf8")))
    : defaultPolicy;
  const evidence = new Evidence(
    values.evidence!,
    command === "replay" ? "replay" : values.fixture ? "fixture" : "openai",
  );
  let demo: Awaited<ReturnType<typeof startDemo>> | undefined;
  let surface: WebSurface | undefined;
  try {
    const decider =
      command === "discover"
        ? values.fixture
          ? new FixtureDecider()
          : new OpenAIDecider(evidence, config.openai)
        : undefined;
    if (!values.target) demo = await startDemo(values.scenario as Scenario);
    surface = await WebSurface.open(
      values.target ?? demo!.url,
      policy,
      values.headed,
    );
    const handoff = new Handoff(surface, policy, evidence, values.operator!);
    const engine = new Engine(surface, policy, evidence, handoff);
    let result;
    if (command === "discover") {
      const discovery = await engine.discover(
        values.goal ??
          "Look up memberId, read their savings balance and reach savings review.",
        { memberId: values.member },
        decider!,
      );
      if (discovery.artifact) {
        mkdirSync(dirname(values.artifact!), { recursive: true });
        writeFileSync(
          values.artifact!,
          JSON.stringify(discovery.artifact, null, 2),
        );
      }
      result = discovery.result;
    } else
      result = await engine.replay(
        JSON.parse(readFileSync(values.artifact!, "utf8")),
        { memberId: values.member },
      );
    console.log(
      JSON.stringify(
        result.status === "success" && !values["show-output"]
          ? {
              ...result,
              outputs: {
                balance: "[REDACTED; use --show-output for caller data]",
              },
            }
          : result,
        null,
        2,
      ),
    );
    console.log(`Evidence: ${evidence.dir}`);
    process.exitCode = result.status === "failure" ? 1 : 0;
  } catch (error) {
    evidence.result({
      status: "failure",
      code: error instanceof Stop ? error.code : "setup_error",
      step: 0,
      runId: evidence.runId,
    });
    console.error(
      "Setup failed. Check runtime/browser installation, target, artifact, policy, and OPENAI_API_KEY. Raw errors are withheld to prevent credential or page-data leakage.",
    );
    process.exitCode = 1;
  } finally {
    await surface?.close();
    await demo?.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runCli(process.argv.slice(2), loadConfig());
}
