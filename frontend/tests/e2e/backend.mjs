#!/usr/bin/env node
/**
 * Start an isolated backend for the end-to-end suite: its own SQLite file and media folder under
 * tests/e2e/.data (recreated on every run), seeded with the synthetic block, on its own port. It
 * never touches backend/pranamap.db, so a developer's running demo is unaffected.
 *
 * Python: $PRANAMAP_PYTHON, else backend/.venv (Windows or POSIX layout), else `python` on PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, "../../../backend");
const data = join(here, ".data");
const port = process.env.E2E_API_PORT ?? "8010";

const python =
  process.env.PRANAMAP_PYTHON ??
  [join(backend, ".venv/Scripts/python.exe"), join(backend, ".venv/bin/python")].find(existsSync) ??
  "python";

rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });

const env = {
  ...process.env,
  PRANAMAP_DATABASE_URL: `sqlite:///${join(data, "e2e.db").replaceAll("\\", "/")}`,
  PRANAMAP_MEDIA_DIR: join(data, "media"),
  PRANAMAP_DEMO_MODE: "true",
  PRANAMAP_SMS_PROVIDER: "console",
  PYTHONIOENCODING: "utf-8",
};

const seed = spawnSync(python, ["-m", "scripts.seed_synthetic"], { cwd: backend, env, stdio: "inherit" });
if (seed.status !== 0) {
  console.error("e2e: seeding failed");
  process.exit(seed.status ?? 1);
}

const server = spawn(python, ["-m", "uvicorn", "app.main:app", "--port", port, "--log-level", "warning"], { cwd: backend, env, stdio: "inherit" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
server.on("exit", (code) => process.exit(code ?? 0));
