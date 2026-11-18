import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load server/.env without letting tsx rewrite dotenv's CJS export. */
const require = createRequire(import.meta.url);
const dotenv = require("dotenv") as {
  config: (opts?: { path?: string }) => void;
};
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(here, "../.env"),
});
