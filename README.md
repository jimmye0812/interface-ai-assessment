# UI Capability Lab

This project uses an LLM to learn a task in a local servicing app. It saves the steps as a reusable capability, then replays them without calling the model.

The demo searches for a member, opens their record, reads their savings balance, and reaches the review screen. It stops before any transfer. The app uses an iframe and tables. All member data is fictional.

## Setup

Install Node.js 24.x and npm, then open a terminal in the project directory. No database or separate application server is needed.

On Windows, use PowerShell. On macOS, use Terminal.

```sh
npm ci
npx playwright install chromium
```

On Linux, install Chromium and its system dependencies.

```sh
npm ci
npx playwright install --with-deps chromium
```

The Linux dependency step may ask for administrator access. See the [Playwright browser setup guide](https://playwright.dev/docs/browsers#install-system-dependencies) if installation fails.

Run the checks on any platform.

```sh
npm run check
npm test
```

## Model configuration

Discovery requires an OpenAI API key. Replay and the offline demo do not.

Create a `.env` file in the project directory using [.env.example](.env.example) as a template. Add your key there.

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=60000
```

The app loads this file automatically when you run a command from the project directory. Values already set in your terminal take priority. The `.env` file is ignored by Git.

To enter the key without displaying it or putting it in shell history, use the secure launcher.

```sh
npm run discover:secure -- --artifact evidence/capability.json --evidence evidence/discovery
```

You can also set the key in your terminal before running the discovery command below.

Windows PowerShell

```powershell
$env:OPENAI_API_KEY = "<your-api-key>"
```

macOS or Linux

```sh
export OPENAI_API_KEY="<your-api-key>"
```

The default model is `gpt-4.1-mini`. Set `OPENAI_MODEL` to change it. `OPENAI_TIMEOUT_MS` controls the request timeout. It defaults to 60000 and accepts values up to 180000.

The config module reads and validates these settings at startup. A missing `.env` file is fine when settings come from your terminal or when running offline. The secure launcher only asks for a key if neither source supplies one.

## Run discovery and replay

With the key set, run discovery.

```sh
npm run demo -- discover --goal "Look up memberId, read their savings balance, and reach savings review" --member 12345 --artifact evidence/capability.json --evidence evidence/discovery
```

Replay the saved capability with a different member. This command does not use the model.

```sh
npm run demo -- replay --artifact evidence/capability.json --member 54321 --evidence evidence/replay
```

Each run starts a local app and a browser, then closes them when finished. Add `--headed` to see the browser.

Keep the goal as a task description and pass the member number through `--member`. Use fictional data only. The result returned to the caller includes the balance. Terminal output and saved logs hide it by default. Use `--show-output` to display it in the terminal.

A success or known business outcome exits with code 0. A failure exits with code 1. Invalid command usage exits with code 2.

## Try error cases

These commands show a missing member and recovery from a known notice.

```sh
npm run demo -- replay --artifact evidence/capability.json --member 99999 --evidence evidence/not-found
npm run demo -- replay --artifact evidence/capability.json --scenario interstitial --evidence evidence/recovery
```

Other `--scenario` values are `normal`, `not_found`, `validation`, `denied`, `expired`, `slow`, `app_error`, and `dialog`.

Missing members, validation errors, and permission denials return business outcomes. Slow loads have a wait limit. App errors and unexpected dialogs stop the run and create an intervention request.

## Take over a session

Run the expiry scenario with the operator console enabled.

```sh
npm run demo -- replay --artifact evidence/capability.json --scenario expired --operator --evidence evidence/manual-handoff
```

1. Open the **Operator takeover** URL printed in the terminal. Include the full token after the hash.
2. Click **Restore training session**. This operates the same browser page that automation was using.
3. Click **Return control**. Replay checks the page state before continuing.

The console shows a summary of the live page and offers two recovery controls. It does not stream the browser screen. Manual actions through the console are logged. Direct actions in a visible browser are not.

Without `--operator`, the run saves the intervention request and returns a failure. Expired sessions can resume after restoration. Other hard failures stop after inspection. The system does not repeat an action whose result is uncertain.

## Run without an API key

```sh
npm run demo -- discover --fixture --artifact runs/fixture-capability.json
npm run demo -- replay --artifact runs/fixture-capability.json --member 54321
```

The fixture uses scripted decisions with a real browser. It is useful for testing, but it is not an LLM discovery run. The tests also run without model calls.

## Design and evidence

[REPORT.md](REPORT.md) explains the design and its limits. [evidence/README.md](evidence/README.md) links to the saved capability, genuine discovery log, and replay results.

Run `npm run evidence` to repeat the replay scenarios using the saved capability. Its handoff case uses an automated operator driver and is labeled that way. Use the manual steps above to record a human-operated handoff.

## Development

Use `npm run format` to format the source and docs, or `npm run format:check` to check them. Run `npm run schema` after changing the artifact schema.

The action and route allowlist is in `config/policy.json`. Pass `--policy` to use another policy file. Pass `--target http://127.0.0.1:PORT` to use an already running app with the same control layout. This demo only allows local targets.
