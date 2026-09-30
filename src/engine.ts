import {
  Artifact,
  Inputs,
  contract,
  type Action,
  type Result,
  type State,
} from "./schema.js";
import { Stop, authorize, type Policy, type Surface } from "./surface.js";
import { Evidence } from "./evidence.js";
import { Handoff } from "./operator.js";
import type { Decider } from "./model.js";

export class Engine {
  private index = 0;
  private expected: State | undefined;
  private observed: State | undefined;
  private deadline = 0;
  constructor(
    private surface: Surface,
    private policy: Policy,
    private evidence: Evidence,
    private handoff: Handoff,
  ) {}
  private guard() {
    if (Date.now() > this.deadline) throw new Stop("run_timeout");
    if (this.handoff.owner !== "automation")
      throw new Stop("automation_not_owner");
  }
  private async stable(): Promise<State> {
    this.guard();
    let obs = await this.surface.settle();
    if (obs.state === "interstitial") {
      this.evidence.event("recovery", { code: "known_notice", attempt: 1 });
      await this.surface.act(
        {
          kind: "click",
          target: "acknowledge",
          parameter: null,
          reason: "open_record",
        },
        { memberId: "" },
      );
      obs = await this.surface.settle();
    }
    if (obs.state === "expired") {
      const pause = Date.now();
      await this.handoff.request({
        code: "session_expired",
        step: this.index,
        expected: this.expected,
        observation: obs,
      });
      this.deadline += Date.now() - pause;
      obs = await this.surface.settle();
    }
    this.observed = obs.state;
    if (["not_found", "validation", "denied"].includes(obs.state))
      throw new Stop(`business:${obs.state}`);
    if (
      ["unknown", "loading", "app_error", "expired", "interstitial"].includes(
        obs.state,
      )
    )
      throw new Stop(obs.state);
    return obs.state;
  }
  private async failure(error: unknown): Promise<Result> {
    const code = error instanceof Stop ? error.code : "execution_error";
    if (code.startsWith("business:"))
      return {
        status: "business_outcome",
        code: code.slice(9) as "not_found" | "validation" | "denied",
        step: this.index,
        runId: this.evidence.runId,
      };
    const observation = await this.surface.observe().catch(() => ({
      state: "unknown" as const,
      controls: [],
      frame: "Workspace" as const,
    }));
    this.evidence.snapshot(observation);
    // Terminal failures can be inspected/operated, but are never blindly retried.
    if (
      ![
        "intervention_required",
        "handoff_timeout",
        "human_aborted",
        "operator_driver_failed",
      ].includes(code)
    ) {
      try {
        await this.handoff.request({
          code,
          step: this.index,
          expected: this.expected,
          observation,
        });
      } catch {
        /* preserve original cause */
      }
    }
    return {
      status: "failure",
      code,
      step: this.index,
      expected: this.expected,
      observed: observation.state,
      runId: this.evidence.runId,
    };
  }
  async discover(
    goal: string,
    rawInputs: unknown,
    decider: Decider,
  ): Promise<{ result: Result; artifact?: Artifact }> {
    this.deadline = Date.now() + this.policy.runTimeoutMs;
    const steps: Artifact["steps"] = [];
    const history: Action[] = [];
    let balance: string | undefined;
    let result: Result;
    let artifact: Artifact | undefined;
    try {
      const parsedInputs = Inputs.safeParse(rawInputs);
      if (!parsedInputs.success) throw new Stop("invalid_input");
      const inputs = parsedInputs.data;
      for (this.index = 0; this.index < this.policy.maxSteps; this.index++) {
        const before = await this.stable();
        const observation = await this.surface.observe();
        // Goal verification is deterministic; do not spend a model call to
        // approve a checkpoint that the executor can verify itself.
        const action: Action =
          before === "review" && balance !== undefined
            ? {
                kind: "finish",
                target: null,
                parameter: null,
                reason: "goal_complete",
              }
            : await decider.decide(goal, observation, history);
        this.guard();
        authorize(action, this.policy);
        if (action.kind === "finish") {
          if (before !== "review" || balance === undefined)
            throw new Stop("checkpoint_failed");
          const verified = await this.surface.act(
            {
              kind: "read",
              target: "balance",
              parameter: null,
              reason: "read_balance",
            },
            inputs,
          );
          if (verified !== balance) throw new Stop("output_changed");
          this.evidence.event("checkpoint_verified", {
            state: "review",
            output: "balance",
            matched: true,
          });
          artifact = contract(steps, decider.provenance);
          result = {
            status: "success",
            outputs: { balance },
            runId: this.evidence.runId,
          };
          this.evidence.result(result);
          return { result, artifact };
        }
        if (
          history.length >= 3 &&
          history
            .slice(-3)
            .every((a) => JSON.stringify(a) === JSON.stringify(action))
        )
          throw new Stop("repeated_action");
        const output = await this.surface.act(action, inputs);
        if (output !== undefined) balance = output;
        const after = await this.stable();
        const step = { action, before, after };
        steps.push(step);
        history.push(action);
        this.evidence.event("step", { index: this.index, ...step });
      }
      throw new Stop("step_limit");
    } catch (error) {
      result = await this.failure(error);
    }
    this.evidence.result(result);
    return { result };
  }
  async replay(rawArtifact: unknown, rawInputs: unknown): Promise<Result> {
    this.deadline = Date.now() + this.policy.runTimeoutMs;
    let result: Result;
    try {
      const parsedArtifact = Artifact.safeParse(rawArtifact);
      if (!parsedArtifact.success) throw new Stop("invalid_artifact");
      const artifact = parsedArtifact.data;
      const parsedInputs = Inputs.safeParse(rawInputs);
      if (!parsedInputs.success) throw new Stop("invalid_input");
      const inputs = parsedInputs.data;
      // Validate the entire executable plan before the first action.
      for (const step of artifact.steps) {
        authorize(step.action, this.policy);
        if (step.action.kind === "finish")
          throw new Stop("invalid_artifact_step");
      }
      let balance: string | undefined;
      for (this.index = 0; this.index < artifact.steps.length; this.index++) {
        const step = artifact.steps[this.index];
        this.expected = step.before;
        if ((await this.stable()) !== step.before)
          throw new Stop("precondition_mismatch");
        this.guard();
        const value = await this.surface.act(step.action, inputs);
        if (value !== undefined) balance = value;
        this.expected = step.after;
        if ((await this.stable()) !== step.after)
          throw new Stop("postcondition_mismatch");
        this.evidence.event("step", { index: this.index, ...step });
      }
      this.expected = artifact.checkpoint;
      if (
        (await this.stable()) !== artifact.checkpoint ||
        balance === undefined
      )
        throw new Stop("checkpoint_failed");
      const verified = await this.surface.act(
        {
          kind: "read",
          target: "balance",
          parameter: null,
          reason: "read_balance",
        },
        inputs,
      );
      if (verified !== balance) throw new Stop("output_changed");
      this.evidence.event("checkpoint_verified", {
        state: "review",
        output: "balance",
        matched: true,
      });
      result = {
        status: "success",
        outputs: { balance },
        runId: this.evidence.runId,
      };
    } catch (error) {
      result = await this.failure(error);
    }
    this.evidence.result(result);
    return result;
  }
}
