import { request } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * T096a global setup, against the development compose stack:
 *
 * 1. registers a run-scoped administrator (`@example.test`) through the API;
 * 2. promotes it with the SEC-009 bootstrap script inside the api container:
 *    `docker compose exec api yarn workspace api admin:bootstrap --email <admin>`,
 *    after revoking an earlier run's `e2e-admin-<run id>@example.test`
 *    administrator (SEC-009 refuses a second active one; others are kept);
 * 3. loads the declared T046 parser templates through the admin API (skipped
 *    when an identically named template is already there);
 * 4. hands the run id and admin credentials to the specs through environment
 *    variables (inherited by the workers), never through a file.
 *
 * Every identity and password is synthetic and generated per run.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000/api";
const DECLARATION = join(REPO_ROOT, "docs", "operations", "supported-parsers.md");

type Envelope<T> = { success: boolean; data: T };

/** Template files declared in docs/operations/supported-parsers.md (T046). */
const declaredTemplates = (): string[] => {
  const text = readFileSync(DECLARATION, "utf8");
  const block = text.split("<!-- supported-parsers:begin -->")[1]?.split("<!-- supported-parsers:end -->")[0] ?? "";
  return block
    .split("\n")
    .filter((line) => line.startsWith("|") && line.includes(".json"))
    .map((line) => line.split("|").map((cell) => cell.trim())[4])
    .filter(Boolean);
};

/** Runs the SEC-009 bootstrap script inside the api container. */
const adminScript = (args: string[]) => {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "api", "yarn", "workspace", "api", "admin:bootstrap", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 180_000 },
  );
  if (result.status !== 0) {
    throw new Error(
      `admin:bootstrap ${args[0]} failed (exit ${result.status}). Is the development compose stack running (docker compose up)?\n${(result.stderr || result.stdout || "").slice(-1500)}`,
    );
  }
  return result.stdout;
};

/** Earlier runs' administrators: only run-scoped `e2e-admin-<run id>@example.test` identities. */
const E2E_ADMIN = /^e2e-admin-[a-z0-9]+@example\.test$/;

const bootstrapAdmin = (email: string) => {
  // SEC-009 refuses a second active administrator, so a previous run's admin
  // (which this runner created) is revoked first; any other admin is left
  // alone and the promotion below then fails loudly.
  const stale = adminScript(["--list-admins"])
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((candidate): candidate is string => Boolean(candidate && E2E_ADMIN.test(candidate)));
  for (const previous of stale) adminScript(["--revoke", "--email", previous]);
  adminScript(["--email", email]);
};

export default async function globalSetup() {
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const admin = {
    email: `e2e-admin-${runId}@example.test`,
    password: `E2e-${randomBytes(12).toString("base64url")}!9`,
  };

  const api = await request.newContext({ baseURL: `${API_URL}/` });
  try {
    const ready = await api.get("health/ready");
    if (!ready.ok()) {
      throw new Error(`The API at ${API_URL} is not ready (${ready.status()}); start the development compose stack.`);
    }
    const registered = await api.post("auth/register", {
      data: { ...admin, fullName: `E2E Admin ${runId}` },
    });
    if (registered.status() !== 201) {
      throw new Error(`Admin registration failed: ${registered.status()}`);
    }

    bootstrapAdmin(admin.email);

    const login = await api.post("auth/login", { data: admin });
    if (login.status() !== 200) throw new Error(`Admin login failed: ${login.status()}`);

    const existing = (await (await api.get("parser-templates")).json()) as Envelope<{ name: string }[]>;
    const names = new Set(existing.data.map((template) => template.name));
    for (const file of declaredTemplates()) {
      const template = JSON.parse(readFileSync(join(REPO_ROOT, file), "utf8")) as { name: string };
      if (names.has(template.name)) continue;
      const created = await api.post("parser-templates", { data: template });
      if (created.status() !== 201) {
        throw new Error(`Loading parser template ${file} failed: ${created.status()}`);
      }
    }
  } finally {
    await api.dispose();
  }

  process.env.E2E_RUN_ID = runId;
  process.env.E2E_ADMIN_EMAIL = admin.email;
  process.env.E2E_ADMIN_PASSWORD = admin.password;
  process.env.E2E_API_URL = API_URL;
}
