import { z } from "zod";
import { bindings } from "./bindings.js";

export const Control = z.enum([
  "memberId",
  "search",
  "details",
  "balance",
  "review",
  "amount",
  "confirm",
  "acknowledge",
  "restore",
]);
export type Control = z.infer<typeof Control>;
export const State = z.enum([
  "search",
  "results",
  "details",
  "review",
  "not_found",
  "validation",
  "denied",
  "expired",
  "interstitial",
  "loading",
  "app_error",
  "unknown",
]);
export type State = z.infer<typeof State>;
export const Action = z
  .object({
    kind: z.enum(["fill", "click", "read", "finish"]),
    target: Control.nullable(),
    parameter: z.enum(["memberId"]).nullable(),
    reason: z.enum([
      "enter_input",
      "find_record",
      "open_record",
      "read_balance",
      "reach_review",
      "goal_complete",
    ]),
  })
  .strict();
export type Action = z.infer<typeof Action>;
export const Step = z
  .object({ action: Action, before: State, after: State })
  .strict();
export const Artifact = z
  .object({
    schemaVersion: z.literal("1.0"),
    capabilityVersion: z.literal("1.0.0"),
    name: z.literal("savings-review"),
    surface: z.literal("legacy-web"),
    compatibility: z
      .object({
        product: z.literal("training-servicer"),
        version: z.literal("1"),
        bindingVersion: z.literal("1"),
      })
      .strict(),
    inputs: z
      .object({
        memberId: z
          .object({
            type: z.literal("string"),
            pattern: z.literal("^[0-9]{5}$"),
            sensitive: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    outputs: z
      .object({
        balance: z
          .object({
            type: z.literal("decimal"),
            currency: z.literal("USD"),
            sensitive: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    checkpoint: z.literal("review"),
    steps: z.array(Step).min(1).max(24),
    targeting: z
      .object({
        frame: z.literal('iframe[title="Workspace"]'),
        uniqueness: z.literal("exactly_one"),
        bindings: z.record(
          Control,
          z
            .object({
              strategy: z.enum(["label", "role", "css"]),
              value: z.string().max(100),
              risk: z.enum(["reversible", "irreversible"]),
            })
            .strict(),
        ),
      })
      .strict(),
    provenance: z
      .object({
        kind: z.enum(["openai", "fixture"]),
        model: z.string().max(100),
        responseIds: z.array(z.string().max(100)),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    for (const key of Control.options) {
      const found = artifact.targeting.bindings[key];
      const expected = bindings[key];
      if (
        !found ||
        found.strategy !== expected.strategy ||
        found.value !== expected.value ||
        found.risk !== expected.risk
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unreviewed binding profile",
          path: ["targeting", "bindings", key],
        });
    }
  });
export type Artifact = z.infer<typeof Artifact>;
export const Inputs = z
  .object({
    memberId: z
      .string()
      .length(5)
      .regex(/^[0-9]{5}$/),
  })
  .strict();
export type Result =
  | { status: "success"; outputs: { balance: string }; runId: string }
  | {
      status: "business_outcome";
      code: "not_found" | "validation" | "denied";
      step: number;
      runId: string;
    }
  | {
      status: "failure";
      code: string;
      step: number;
      expected?: State;
      observed?: State;
      runId: string;
    };
export function contract(
  steps: Artifact["steps"],
  provenance: Artifact["provenance"],
): Artifact {
  return Artifact.parse({
    schemaVersion: "1.0",
    capabilityVersion: "1.0.0",
    name: "savings-review",
    surface: "legacy-web",
    compatibility: {
      product: "training-servicer",
      version: "1",
      bindingVersion: "1",
    },
    inputs: {
      memberId: { type: "string", pattern: "^[0-9]{5}$", sensitive: true },
    },
    outputs: { balance: { type: "decimal", currency: "USD", sensitive: true } },
    checkpoint: "review",
    targeting: {
      frame: 'iframe[title="Workspace"]',
      uniqueness: "exactly_one",
      bindings,
    },
    steps,
    provenance,
  });
}
