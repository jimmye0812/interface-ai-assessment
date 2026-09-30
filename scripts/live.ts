// Optional interactive key entry: no shell history, terminal echo or key file.
import { loadConfig } from "../src/config.js";
import { runCli } from "../src/cli.js";

const config = loadConfig();
let apiKey = config.openai.apiKey;
if (!apiKey) {
  if (!process.stdin.isTTY)
    throw new Error("Use a terminal or configure OPENAI_API_KEY.");
  process.stderr.write("OpenAI API key (hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    apiKey = await new Promise<string>((resolve, reject) => {
      let key = "";
      const receive = (chunk: Buffer) => {
        for (const char of chunk.toString()) {
          if (char === "\u0003") {
            process.stdin.off("data", receive);
            reject(new Error("Cancelled"));
            return;
          }
          if (char === "\r" || char === "\n") {
            process.stdin.off("data", receive);
            resolve(key);
            return;
          }
          if (char === "\u007f" || char === "\b") key = key.slice(0, -1);
          else key += char;
        }
      };
      process.stdin.on("data", receive);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stderr.write("\n");
  }
}
await runCli(["discover", ...process.argv.slice(2)], {
  ...config,
  openai: { ...config.openai, apiKey: apiKey?.trim() || undefined },
});
