import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "playwright";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Action, Control, type State } from "./schema.js";
import { bindings } from "./bindings.js";

export const PolicySchema = z
  .object({
    routes: z.array(z.string()),
    actions: z.array(Action.shape.kind),
    controls: z.array(Control),
    humanControls: z.array(Control),
    blockedControls: z.array(Control),
    timeoutMs: z.number().int().positive().max(30000),
    maxSteps: z.number().int().positive().max(24),
    runTimeoutMs: z.number().positive(),
    handoffTimeoutMs: z.number().positive(),
  })
  .strict();
export const defaultPolicy = PolicySchema.parse(
  JSON.parse(
    readFileSync(new URL("../config/policy.json", import.meta.url), "utf8"),
  ),
);
export type Policy = z.infer<typeof PolicySchema>;
export class Stop extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export const headings: Partial<Record<State, string>> = {
  search: "Member search",
  results: "Search results",
  details: "Member details",
  review: "Savings review",
  not_found: "Member not found",
  validation: "Invalid member number",
  denied: "Permission denied",
  expired: "Session expired",
  interstitial: "Service notice",
  loading: "Loading",
  app_error: "Application unavailable",
};
export type Observation = {
  state: State;
  controls: Control[];
  frame: "Workspace";
  structure?: { tag: string; role: string | null }[];
};
export interface Surface {
  observe(): Promise<Observation>;
  act(
    action: Action,
    inputs: { memberId: string },
    human?: boolean,
  ): Promise<string | undefined>;
  settle(): Promise<Observation>;
  close(): Promise<void>;
}
export function permittedUrl(
  raw: string,
  origin: string,
  policy: Policy,
): boolean {
  try {
    const u = new URL(raw);
    return (
      u.origin === origin &&
      !u.username &&
      !u.password &&
      !u.search &&
      policy.routes.includes(u.pathname)
    );
  } catch {
    return false;
  }
}
export function authorize(action: Action, policy: Policy, human = false) {
  Action.parse(action);
  if (!policy.actions.includes(action.kind)) throw new Stop("action_blocked");
  if (action.kind === "finish") {
    if (action.target !== null || action.parameter !== null)
      throw new Stop("invalid_action");
    return;
  }
  if (!action.target) throw new Stop("missing_target");
  if (
    policy.blockedControls.includes(action.target) ||
    bindings[action.target].risk === "irreversible"
  )
    throw new Stop("risky_action_blocked");
  if (!(human ? policy.humanControls : policy.controls).includes(action.target))
    throw new Stop("control_blocked");
  if (
    action.kind === "fill" &&
    (action.target !== "memberId" || action.parameter !== "memberId")
  )
    throw new Stop("invalid_parameter_binding");
  if (action.kind !== "fill" && action.parameter !== null)
    throw new Stop("unexpected_parameter");
  if (action.kind === "read" && action.target !== "balance")
    throw new Stop("invalid_read");
  if (
    action.kind === "click" &&
    ["memberId", "balance"].includes(action.target)
  )
    throw new Stop("invalid_click");
}
export class WebSurface implements Surface {
  private violation = false;
  private unexpectedDialog = false;
  private constructor(
    public browser: Browser,
    public context: BrowserContext,
    public page: Page,
    public origin: string,
    public policy: Policy,
  ) {}
  static async open(origin: string, policy = defaultPolicy, headed = false) {
    const url = new URL(origin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Stop("target_blocked");
    const browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const page = await context.newPage();
    const surface = new WebSurface(browser, context, page, url.origin, policy);
    await context.routeWebSocket("**/*", (socket) => {
      surface.violation = true;
      socket.close();
    });
    await context.route("**/*", async (route) => {
      if (
        !permittedUrl(route.request().url(), url.origin, policy) ||
        route.request().method() !== "GET"
      ) {
        surface.violation = true;
        await route.abort();
      } else await route.continue();
    });
    context.on("page", (popup) => {
      if (popup !== page) {
        surface.violation = true;
        void popup.close();
      }
    });
    page.on("dialog", (dialog) => {
      surface.unexpectedDialog = true;
      void dialog.dismiss();
    });
    page.on("download", (download) => {
      surface.violation = true;
      void download.cancel();
    });
    try {
      await page.goto(url.origin, {
        waitUntil: "domcontentloaded",
        timeout: policy.timeoutMs,
      });
      await page
        .frameLocator('iframe[title="Workspace"]')
        .getByRole("heading", { name: "Member search", exact: true })
        .waitFor({ timeout: policy.timeoutMs });
      return surface;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }
  check() {
    if (this.violation) throw new Stop("network_policy_violation");
    if (this.unexpectedDialog) throw new Stop("unexpected_dialog");
    if (
      this.page
        .frames()
        .some((frame) => !permittedUrl(frame.url(), this.origin, this.policy))
    )
      throw new Stop("navigation_blocked");
  }
  locator(control: Control): Locator {
    const frame = this.page.frameLocator('iframe[title="Workspace"]');
    const binding = bindings[control];
    if (binding.strategy === "label")
      return frame.getByLabel(binding.value, { exact: true });
    if (binding.strategy === "role")
      return frame.getByRole("button", { name: binding.value, exact: true });
    return frame.locator(binding.value);
  }
  async observe(): Promise<Observation> {
    this.check();
    const frame = this.page.frameLocator('iframe[title="Workspace"]');
    let state: State = "unknown";
    for (const [key, title] of Object.entries(headings)) {
      const locator = frame.getByRole("heading", { name: title, exact: true });
      const count = await locator.count();
      if (count > 1) throw new Stop("ambiguous_state");
      if (count === 1 && (await locator.isVisible())) {
        if (state !== "unknown") throw new Stop("ambiguous_state");
        state = key as State;
      }
    }
    const controls: Control[] = [];
    for (const key of Control.options)
      if (
        (await this.locator(key).count()) === 1 &&
        (await this.locator(key).isVisible())
      )
        controls.push(key);
    // Persist only structure, never arbitrary text/attributes/values from an unknown page.
    const structure = await frame.locator("body *").evaluateAll((nodes) =>
      nodes.slice(0, 80).map((n) => ({
        tag: n.tagName,
        role: ["button", "alert", "dialog"].includes(
          n.getAttribute("role") ?? "",
        )
          ? n.getAttribute("role")
          : null,
      })),
    );
    return { state, controls, frame: "Workspace", structure };
  }
  async settle() {
    const deadline = Date.now() + this.policy.timeoutMs;
    while (Date.now() < deadline) {
      const obs = await this.observe();
      if (obs.state !== "loading" && obs.state !== "unknown") return obs;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Stop("load_timeout");
  }
  async act(action: Action, inputs: { memberId: string }, human = false) {
    this.check();
    authorize(action, this.policy, human);
    if (action.kind === "finish") return;
    const locator = this.locator(action.target!);
    if ((await locator.count()) !== 1)
      throw new Stop("ambiguous_or_missing_target");
    if (action.kind === "fill")
      await locator.fill(inputs.memberId, { timeout: this.policy.timeoutMs });
    if (action.kind === "click")
      await locator.click({ timeout: this.policy.timeoutMs });
    if (action.kind === "read") {
      const value = (
        await locator.innerText({ timeout: this.policy.timeoutMs })
      ).trim();
      if (!/^\d{1,12}\.\d{2}$/.test(value)) throw new Stop("invalid_output");
      return value;
    }
    this.check();
  }
  async close() {
    await this.browser.close();
  }
}
