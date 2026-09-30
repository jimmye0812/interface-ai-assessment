import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const entryPage = readFileSync(
  new URL("./pages/entry.html", import.meta.url),
  "utf8",
);
const workspacePage = readFileSync(
  new URL("./pages/workspace.html", import.meta.url),
  "utf8",
);

export type Scenario =
  | "normal"
  | "not_found"
  | "validation"
  | "denied"
  | "expired"
  | "interstitial"
  | "slow"
  | "app_error"
  | "dialog";

export async function startDemo(scenario: Scenario = "normal") {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    if (request.url === "/") {
      response.end(entryPage);
      return;
    }

    if (request.url === "/workspace") {
      response.end(
        workspacePage.replace("__SCENARIO__", JSON.stringify(scenario)),
      );
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
