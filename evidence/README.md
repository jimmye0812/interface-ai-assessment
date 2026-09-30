# Evidence index

Captured on 2026-09-30 against the live local training application in Chromium. All application data is fictional. Sensitive parameter values and extracted balances are intentionally omitted from saved evidence.

## Successful genuine discovery

- [Saved capability](capability.json)
- [Discovery log](discovery/39683b72-2018-4610-8602-bd7685267c90/events.jsonl)
- [Discovery result](discovery/39683b72-2018-4610-8602-bd7685267c90/result.json)

Provider: OpenAI Responses API. Model: `gpt-4.1-mini`. Five real model decisions drove five real UI actions: fill the parameter, search, open the record, read the balance, and enter review. Each decision includes its provider response ID and token usage. The controller independently verified the final checkpoint and re-read the output before recording success. No scripted decider was used for this run.

## Deterministic replay

All replays below use that saved artifact and a different member parameter. Replay does not instantiate or invoke a model.

| Scenario | Result | Log |
| --- | --- | --- |
| Normal | Success | [events](normal/60374519-607c-4efe-be86-1b1558459088/events.jsonl) |
| Not found | Business outcome | [events](not_found/b16c8b17-ca9e-4ad8-9d32-1c528a19b578/events.jsonl) |
| Known notice | Dismissed once; success | [events](interstitial/ea9c0e97-3672-4285-baff-5f7e6b3f92d4/events.jsonl) |
| Slow load | Bounded wait; success | [events](slow/39a69e58-21e3-43ba-8777-67dbec257e29/events.jsonl) |
| Application error | Failure and intervention request | [events](app_error/c7585f04-4f7f-4d65-b224-8586306f42c5/events.jsonl), [snapshot](app_error/c7585f04-4f7f-4d65-b224-8586306f42c5/failure-structure.json) |
| Unexpected dialog | Dismissed and stopped | [events](dialog/86429eec-6a87-4e58-a5bf-56bdde78673b/events.jsonl) |
| Session expiry | Takeover, restore, resume; success | [events](expired/37006f14-99aa-47d5-949e-0b0eab0185bd/events.jsonl) |

Each run directory also contains `result.json`; failures/interventions include `failure-structure.json`. [Machine-readable replay index](replay-index.json).

The expiry demonstration uses an **automated operator test driver**, explicitly identified in the log. The handoff server, ownership changes, UI restoration on the same page, action audit and resumed replay are real. This is not evidence of an actual human operating the console. To do that yourself, follow the interactive takeover commands in the root README.

## Earlier attempts, preserved honestly

- `discovery/343b269e-2796-415d-859c-a4c26e6d1491`: a genuine model selected `click` on the read-only balance; policy blocked it. The control descriptions were then clarified.
- `discovery/9ffbc30b-3544-4b7c-b601-46faa2d8e63a`: five genuine UI actions reached review, but an unnecessary final model completion call timed out. That earlier code reported a generic execution error. Completion checking is now deterministic and provider timeouts have an explicit code.
- `discovery/4ecfa720-948d-4c77-aa62-94dcadca3777`: provider timeout before the first decision. No capability was saved.
- `discovery/f3cdf661-ebdc-4084-b360-60c709093831`: start-only log from the initial demo-page startup defect, before any model call. It is not discovery evidence.

These attempts are not counted as successful discovery and were not used to manufacture the saved artifact.

## Validation

Original implementation checks passed: `npm run check`, `npm run schema`, and `npm test` (**18 passed, 0 failed**), on Node.js 22.16.0 / Playwright 1.55.1 / Windows. This runtime describes the historical runs above, not the current project requirement. Tests cover the real UI flow, changed parameters, business outcomes, known-notice recovery, loading deadlines, unexpected dialogs, live-session handoff, unauthorized/unsafe operator commands, operator timeout, malformed input, tampered artifacts/bindings, ambiguous targets, false success and actual off-origin request blocking.

The project now targets **Node.js 24.x**. Migration validation on **Node.js 24.21.0**, with `@types/node` 24.19.0, passed `npm run format:check`, `npm run check`, `npm run schema`, and all **18 tests**. The original genuine-discovery artifact also replayed successfully under Node 24: [replay log](node24-replay/2ff79cff-b8f6-4ba9-9541-7e55769c658a/events.jsonl), [result](node24-replay/2ff79cff-b8f6-4ba9-9541-7e55769c658a/result.json). Historical discovery logs have not been rewritten or relabeled.

A source/evidence scan found no API key, bearer credential, member parameter values or extracted balance values in the saved evidence. The fixture test suite and simulated operator are separate from the genuine discovery provenance.
