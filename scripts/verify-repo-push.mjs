// Push verify-repo/ to github.com/nosorry-maths/nosorry-verify (main), as one commit replacing the tree.
// The token is read from var/github-token.txt (or GITHUB_VERIFY_TOKEN) and passed to git in an http header through the
// environment — never on the command line, never printed.
//   node scripts/verify-repo-push.mjs ["commit message"]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = process.env.GITHUB_VERIFY_REPO ?? "nosorry-maths/nosorry-verify";
const token = (process.env.GITHUB_VERIFY_TOKEN ?? fs.readFileSync("var/github-token.txt", "utf8")).trim();
const msg = process.argv[2] ?? "Update the verifier";
const AUTHOR_EMAIL = "verifier@nosorry.invalid";
const src = path.resolve("verify-repo");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nv-push-"));
const auth = "AUTHORIZATION: basic " + Buffer.from(`x-access-token:${token}`).toString("base64");
const genv = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: auth, GIT_TERMINAL_PROMPT: "0" };
const git = (args, cwd = tmp) => execFileSync("git", args, { cwd, env: genv, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
try {
  git(["clone", "-q", "--depth", "1", `https://github.com/${REPO}.git`, "."]);
  for (const f of fs.readdirSync(tmp)) if (f !== ".git") fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
  fs.cpSync(src, tmp, { recursive: true });
  git(["add", "-A"]);
  // An address that belongs to NO GitHub account (a <name>@users.noreply.github.com address is credited to the account <name>).
  git(["-c", "user.name=nosorry verifier", "-c", `user.email=${AUTHOR_EMAIL}`, "commit", "-q", "--allow-empty", "-m", msg]);
  git(["push", "-q", "origin", "HEAD:main"]);
  console.log("pushed:", git(["rev-parse", "HEAD"]).trim());
} catch (e) {
  console.error("push failed:", String(e.stderr ?? e.message).replaceAll(token, "***").slice(0, 2000));
  process.exitCode = 1;
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
