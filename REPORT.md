# Architecture

The project uses TypeScript on Node.js 24 and Playwright to control Chromium. A local servicing app provides the target UI. The task is to find a member, read their savings balance, and reach the review screen. All data is fictional.

During discovery, the model sees the current state and available controls. It chooses one action at a time. The executor checks that action against policy, performs it, and observes the result. The controller verifies completion itself. Replay runs the saved steps without a model.

The `Surface` interface separates browser operations from the flow. The browser adapter uses a prepared set of labels and selectors. This keeps control targeting predictable and limits the data sent to the model. It also means the system cannot explore an unfamiliar app without a new profile.

The code runs in one process because the demo handles one session at a time. Environment settings are loaded through a config module and passed to the model adapter. There is no need for a queue or separate services at this scale.

# Artifact schema

The artifact is a versioned JSON file. It describes the supported inputs, outputs, controls, steps, and final checkpoint. It also records the app profile version and the model response IDs from discovery.

Each step names an action and its target. It records the expected state before and after the action. Member numbers are stored as parameter references. Their actual values stay out of the artifact. The balance output is a decimal string with a currency field to avoid rounding errors.

The artifact includes the control bindings so a reviewer can see how each target is found. Runtime validation requires those bindings to match the installed profile. It rejects unknown fields and unsupported versions. Policy checks cover the whole plan before replay starts.

The files are not signed. A production system would need an approval process and a record of who reviewed each version. Once approved, that version should remain unchanged.

# Determinism & error handling

Replay uses exact labels, roles, and a scoped CSS selector inside the workspace frame. A target must match exactly one control. Visible headings identify the current state. The executor checks each state change and stops if it differs from the saved step.

The result distinguishes success, business outcomes, and failures. A missing member is a business outcome. So are validation errors from the app and permission denials. Invalid input from the caller is rejected before any UI action.

Slow loads have a fixed wait limit. A known service notice can be dismissed once. An expired session requests human help. App errors, missing controls, and unexpected states stop the run. Unexpected browser dialogs are dismissed and reported as failures.

Replay does not repeat clicks after an uncertain result. It also does not ask a model to repair the flow. At the review screen, it reads the balance again and checks that it matches the earlier value.

Tests cover changed inputs, runtime errors, altered artifacts, policy checks, and handoff. A workflow that commits transactions would need extra checks to prevent duplicate changes and confirm what the app actually saved.

# Heterogeneity & multi-tenant

The current adapter needs usable labels or known selectors. The iframe and table layout exercise some legacy web behavior, but they do not cover every legacy app.

Another adapter could use desktop accessibility controls. Where those are missing, image matching or OCR could help locate a control. Such targets would need checks for screen size, layout, and ambiguous matches. The flow could still refer to logical controls such as search or balance.

For reuse across institutions, the shared capability should describe the vendor workflow. A separate tenant profile would hold the app address, credential reference, policy, and approved control overrides. An override should never widen the permitted actions.

App and profile versions would need compatibility checks before a run. A small test suite could check each tenant profile before rollout. Runtime state checks would catch further differences. Failed profiles could then be disabled until reviewed. Each tenant would also need its own session and evidence storage.

These are proposed extensions. The demo implements one app profile and one local session.

# Escalation & handoff

The controller tracks whether automation or a human owns the session. When it needs help, it saves the capability name, step, reason, and a page summary. With the operator option enabled, it pauses and starts a local console.

A temporary token protects that console. Its buttons act on the same browser page used by automation. The server handles one operator command at a time and logs completed actions. The operator then returns control. Replay checks the expected page state before continuing.

The expiry example uses a training button to restore the session. This demonstrates control transfer without implementing real sign-in. The saved handoff demo uses an automated operator driver. The README also provides steps for a person to perform the handoff.

The console has only two recovery controls. It does not stream the screen or support arbitrary manual work. Actions outside the console are not logged. Other hard failures allow inspection but end the run. A process crash loses the session.

A production console would need named operators, session assignment, secure screen access, and recovery after a worker crash.

# Safety

A configurable allowlist controls routes, actions, and available controls. Browser routing blocks other destinations, query strings, and requests other than GET. Popups and downloads stop the run. This demo only supports local training targets.

Irreversible controls are blocked even if a policy file tries to allow them. The operator console follows the same restriction. These checks protect the browser flow. Production workers would also need network limits outside the browser.

Member values are inserted locally. The model sees known state names, control names, and page structure. It does not receive the member parameter or extracted balance. Logs record action reasons and state changes without saving those values.

Failure evidence contains element tags and known roles. It leaves out page text, input values, and cookies. The project does not save raw screenshots or browser traces.

The goal text is sent to the model with long numeric values masked. That is not a complete personal-data filter. Goals should describe the task and use the separate member parameter. Only fictional data belongs in this demo.

API keys stay in memory. The model request disables response storage, though provider retention still depends on account terms. The caller receives the balance and must protect it.

# Cuts

The project implements one workflow with a prepared app profile. It does not include desktop support, tenant management, real authentication, or a full operator console. Those features would add scope without improving the main discovery and replay path.

The offline fixture uses scripted decisions. The restore button stands in for session recovery. Both are documented so they are not mistaken for live model discovery or real authentication.

The next steps would be artifact approval, a second app variant, and a more capable operator console. A second variant would test whether the shared flow works with different control bindings. Before adding transactions, the system would also need a reliable way to check whether a change was committed.
