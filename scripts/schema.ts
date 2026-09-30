import { writeFileSync, mkdirSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Artifact } from "../src/schema.js";
mkdirSync("schemas", { recursive: true });
writeFileSync(
  "schemas/capability.schema.json",
  JSON.stringify(zodToJsonSchema(Artifact, "Capability"), null, 2),
);
