// Runs one Lean command for one pipeline stage, either in a throwaway Docker container (production) or locally (dev).
//
// Docker isolation: no network, read-only root fs, all capabilities dropped, no-new-privileges, unprivileged uid,
// pid/cpu/memory limits, a single stage directory mounted (read-only for checker stages).
// Production should additionally use gVisor (VERIFIER_RUNTIME=runsc) or a dedicated sandbox host.
// The verifier image contains the pinned toolchain + Mathlib/formal-conjectures build (see Dockerfile.verifier).

import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const MODE = process.env.VERIFIER_SANDBOX ?? "none";
if (MODE === "none" && process.env.NODE_ENV === "production" && process.env.ALLOW_UNSANDBOXED !== "true") {
  throw new Error("Refusing to verify untrusted Lean without a sandbox in production. Set VERIFIER_SANDBOX=docker.");
}

const IMAGE = process.env.VERIFIER_IMAGE ?? "nosorry-verifier:latest";
// One prebuilt image per Lean workspace, e.g. VERIFIER_IMAGES='{"physlib":"nosorry-verifier:physlib","core":"nosorry-verifier:core"}'
const IMAGES = JSON.parse(process.env.VERIFIER_IMAGES ?? "{}");
// Local (dev) equivalents: LEAN_WORKSPACES='{"physlib":"/path/to/physlib"}', LEAN_BINS='{"physlib":"/path/to/toolchain/bin"}'
const WORKSPACES = JSON.parse(process.env.LEAN_WORKSPACES ?? "{}");
const BINS = JSON.parse(process.env.LEAN_BINS ?? "{}");
const imageFor = (ws) => IMAGES[ws] ?? IMAGE;
const RUNTIME = process.env.VERIFIER_RUNTIME; // e.g. runsc
const LEAN_BIN = process.env.LEAN_BIN ?? ""; // dir with lean/leanchecker of the pinned toolchain; empty = from PATH
const SEP = process.platform === "win32" && MODE === "none" ? ";" : ":";

const wsLeanPaths = new Map();
/** LEAN_PATH of a local Lake workspace (Mathlib, formal-conjectures, Physlib…), computed once per workspace. */
function workspaceLeanPath(name) {
  if (wsLeanPaths.has(name)) return wsLeanPaths.get(name);
  const dir = WORKSPACES[name] ?? (name === "formal-conjectures" ? process.env.LEAN_WORKSPACE : undefined);
  let lp = "";
  if (dir && MODE === "none") {
    try {
      lp = execFileSync(path.join(BINS[name] ?? LEAN_BIN, "lake"), ["env", "printenv", "LEAN_PATH"], { cwd: dir, encoding: "utf8" }).trim();
    } catch (e) {
      console.warn(`[sandbox] could not read LEAN_PATH from workspace ${name}:`, e.message);
    }
  }
  wsLeanPaths.set(name, lp);
  return lp;
}

export const sandboxName = (ws = "formal-conjectures") => (MODE === "docker" ? `docker:${imageFor(ws)}${RUNTIME ? `/${RUNTIME}` : ""}` : `none (dev only, ${ws})`);

/**
 * @param {string} stageDir absolute host path of the stage directory (contains src/ and out/)
 * @param {string} tool 'lean' | 'leanchecker' | 'comparator'
 * @param {string[]} args paths relative to the stage dir
 * @param {{timeoutMs?: number, memMb?: number, readOnly?: boolean}} opts
 */
// Per-sandbox memory cap. Keep it well below the Docker VM's memory: a sandbox hitting the VM limit takes the whole
// daemon down instead of being OOM-killed. With Mathlib a check peaks around 3.5 GB.
const MEM_MB = Number(process.env.VERIFIER_MEM_MB) || 6144;

export function run(stageDir, tool, args, { timeoutMs = 20 * 60_000, memMb = MEM_MB, readOnly = false, workspace = "formal-conjectures" } = {}) {
  let cmd, argv, opts;
  if (MODE === "docker") {
    // How the stage directory reaches the sandbox:
    //  - JOBS_VOLUME (recommended when the worker is containerised): a named volume mounted at JOBS_DIR in the worker;
    //    the sandbox gets only the stage sub-directory of it (volume-subpath, Docker >= 26). Works on any host OS.
    //  - JOBS_HOST_DIR: the same directory as seen by the Docker host (bind mount).
    //  - otherwise the worker runs on the host and the path is used as is.
    const jobsDir = process.env.JOBS_DIR ?? "";
    const rel = path.relative(jobsDir, stageDir).split(path.sep).join("/");
    const mount = process.env.JOBS_VOLUME
      ? ["--mount", `type=volume,src=${process.env.JOBS_VOLUME},dst=/job,volume-subpath=${rel}${readOnly ? ",readonly" : ""}`]
      : ["-v", `${process.env.JOBS_HOST_DIR ? path.posix.join(process.env.JOBS_HOST_DIR, rel) : stageDir}:/job:${readOnly ? "ro" : "rw"}`];
    cmd = "docker";
    argv = [
      "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--user", "65534:65534",
      ...(RUNTIME ? ["--runtime", RUNTIME] : []),
      "--pids-limit", "256", "--cpus", process.env.VERIFIER_CPUS ?? "2", "--memory", `${memMb}m`, "--memory-swap", `${memMb}m`,
      "--tmpfs", "/tmp:rw,size=512m", ...mount, "-w", "/job",
      "-e", "LEAN_PATH_JOB=/job/out", imageFor(workspace), "/usr/local/bin/ns-run", tool, ...args,
    ];
    opts = {};
  } else {
    cmd = path.join(BINS[workspace] ?? LEAN_BIN, tool);
    argv = args;
    // Workspace first, job modules last: job outputs can never shadow Init/Lean/Mathlib.
    const lp = [workspaceLeanPath(workspace), path.join(stageDir, "out")].filter(Boolean).join(SEP);
    opts = { cwd: stageDir, env: { PATH: process.env.PATH, LEAN_PATH: lp, HOME: process.env.HOME ?? "", USERPROFILE: process.env.USERPROFILE ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      // Compare.lean runs its reference export in a child `lean` process: tell it where lean and a temp dir are.
      NOSORRY_LEAN: cmd, NOSORRY_TMP: os.tmpdir() } };
  }
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, argv, { ...opts, windowsHide: true });
    let out = "", killed = false;
    const cap = (d) => { if (out.length < 200_000) out += d.toString(); };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e), ms: Date.now() - t0, timedOut: false }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: killed ? -2 : code, out, ms: Date.now() - t0, timedOut: killed }); });
  });
}
