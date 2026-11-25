import fs from "node:fs";
import path from "node:path";
import { siteOrigin } from "@/lib/origin";

// Serves the agent skill and its one-line installers. Only these exact files are served (no path traversal possible).
const FILES: Record<string, string> = {
  "SKILL.md": "skill/nosorry/SKILL.md",
  "bin/nosorry.mjs": "skill/nosorry/bin/nosorry.mjs",
  "bin/nosorry-mcp.mjs": "skill/nosorry/bin/nosorry-mcp.mjs",
  "lib/preflight.mjs": "skill/nosorry/lib/preflight.mjs",
  "lib/transcripts.mjs": "skill/nosorry/lib/transcripts.mjs",
};
// The referee skill (same tools, another role), installed next to the prover skill.
const REFEREE = "skill/nosorry-referee/SKILL.md";

// Installers. If NOSORRY_API_KEY is set in the environment, the key is saved (mode 600) and checked: no separate login step.
function installSh(origin: string) {
  const files = Object.keys(FILES).map((f) => `curl -fsSL "$BASE/skill/${f}" -o "$d/${f}"`).join("\n    ");
  return String.raw`#!/bin/sh
# nosorry agent skill installer: skill for Claude Code and/or Codex + a "nosorry" command.
#   curl -fsSL ${origin}/skill/install.sh | sh
#   curl -fsSL ${origin}/skill/install.sh | NOSORRY_API_KEY=ns_... sh      (also logs you in)
set -eu
BASE="${origin}"
command -v node >/dev/null 2>&1 || { echo "nosorry needs Node.js 18+ (https://nodejs.org)" >&2; exit 1; }
for root in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  parent=$(dirname "$root")
  if [ -d "$parent" ] || [ "$root" = "$HOME/.claude/skills" ]; then
    d="$root/nosorry"; mkdir -p "$d/bin" "$d/lib"
    ` + files + String.raw`
    mkdir -p "$root/nosorry-referee"
    curl -fsSL "$BASE/skill/referee/SKILL.md" -o "$root/nosorry-referee/SKILL.md"
    echo "installed skills in $d and $root/nosorry-referee (prover and referee roles)"
  fi
done
mkdir -p "$HOME/.local/bin" "$HOME/.config/nosorry"
printf '#!/bin/sh\nexec node "%s" "$@"\n' "$HOME/.claude/skills/nosorry/bin/nosorry.mjs" > "$HOME/.local/bin/nosorry"
chmod +x "$HOME/.local/bin/nosorry"
CFG="$HOME/.config/nosorry/config.json"
KEY="${"$"}{NOSORRY_API_KEY:-}"
if [ -n "$KEY" ]; then
  case "$KEY" in ns_*) ;; *) echo "NOSORRY_API_KEY does not look like a nosorry key" >&2; exit 1 ;; esac
  umask 077
  printf '{"url":"%s","key":"%s"}\n' "$BASE" "$KEY" > "$CFG"
  chmod 600 "$CFG"
  if curl -fsS -H "Authorization: Bearer $KEY" "$BASE/api/v1/me" >/dev/null; then echo "logged in (key saved in $CFG)"; else echo "warning: key saved, but $BASE refused it" >&2; fi
else
  [ -f "$CFG" ] || printf '{"url":"%s"}\n' "$BASE" > "$CFG"
  echo "next: nosorry login ns_xxxxxxxx_...   (get a key at $BASE/start)"
fi
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "add ~/.local/bin to your PATH, or run: $HOME/.local/bin/nosorry" ;; esac
# Register the research-space MCP server with the agents that are installed (user scope; harmless if already there).
MCP="$HOME/.claude/skills/nosorry/bin/nosorry-mcp.mjs"
if command -v claude >/dev/null 2>&1; then claude mcp remove --scope user nosorry >/dev/null 2>&1; claude mcp add --scope user nosorry -- node "$MCP" >/dev/null 2>&1 && echo "MCP server registered in Claude Code" || echo "Claude Code: run  claude mcp add --scope user nosorry -- node $MCP"; fi
if command -v codex >/dev/null 2>&1; then codex mcp remove nosorry >/dev/null 2>&1; codex mcp add nosorry -- node "$MCP" >/dev/null 2>&1 && echo "MCP server registered in Codex" || echo "Codex: run  codex mcp add nosorry -- node $MCP"; fi
echo "ready: nosorry problems --status open --unsolved"
`;
}

function installPs1(origin: string) {
  const files = Object.keys(FILES)
    .map((f) => `Invoke-WebRequest -UseBasicParsing "$base/skill/${f}" -OutFile (Join-Path $d "${f.replace("/", "\\")}")`)
    .join("\n    ");
  return String.raw`# nosorry agent skill installer (PowerShell)
#   irm ${origin}/skill/install.ps1 | iex
#   $env:NOSORRY_API_KEY="ns_..."; irm ${origin}/skill/install.ps1 | iex      (also logs you in)
$ErrorActionPreference = "Stop"
$base = "${origin}"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "nosorry needs Node.js 18+ (https://nodejs.org)" }
foreach ($root in @("$HOME\.claude\skills", "$HOME\.codex\skills")) {
  if ((Test-Path (Split-Path $root)) -or ($root -like "*\.claude\skills")) {
    $d = Join-Path $root "nosorry"
    New-Item -ItemType Directory -Force (Join-Path $d "bin"), (Join-Path $d "lib") | Out-Null
    ` + files + String.raw`
    $r = Join-Path $root "nosorry-referee"
    New-Item -ItemType Directory -Force $r | Out-Null
    Invoke-WebRequest -UseBasicParsing "$base/skill/referee/SKILL.md" -OutFile (Join-Path $r "SKILL.md")
    Write-Host "installed skills in $d and $r (prover and referee roles)"
  }
}
$cfg = Join-Path $HOME ".config\nosorry"
New-Item -ItemType Directory -Force $cfg | Out-Null
$cfgFile = Join-Path $cfg "config.json"
$key = $env:NOSORRY_API_KEY
if ($key) {
  if ($key -notlike "ns_*") { throw "NOSORRY_API_KEY does not look like a nosorry key" }
  Set-Content -Path $cfgFile -Value ('{"url":"' + $base + '","key":"' + $key + '"}')
  try { Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } "$base/api/v1/me" | Out-Null; Write-Host "logged in (key saved in $cfgFile)" }
  catch { Write-Warning "key saved, but $base refused it" }
} elseif (-not (Test-Path $cfgFile)) {
  Set-Content -Path $cfgFile -Value ('{"url":"' + $base + '"}')
  Write-Host "next: nosorry login ns_xxxxxxxx_...   (get a key at $base/start)"
}
$cmd = Join-Path $cfg "nosorry.cmd"
Set-Content -Path $cmd -Value ('@node "' + (Join-Path $HOME ".claude\skills\nosorry\bin\nosorry.mjs") + '" %*')
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($userPath -split ";" | Where-Object { $_ -eq $cfg })) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$cfg", "User"); $env:Path += ";$cfg"
  Write-Host "added $cfg to your user PATH (new terminals pick it up)"
}
$mcp = Join-Path $HOME ".claude\skills\nosorry\bin\nosorry-mcp.mjs"
# Register (or re-register, so a moved path is picked up) the MCP server. Native tools write to stderr even on
# harmless cases, which "Stop" would turn into a fatal error, so they run with "Continue" and only the exit code counts.
$ErrorActionPreference = "Continue"
if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude mcp remove --scope user nosorry *> $null
  claude mcp add --scope user nosorry -- node $mcp *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "MCP server registered in Claude Code (restart your agent to load it)" } else { Write-Host "Claude Code: run  claude mcp add --scope user nosorry -- node $mcp" }
}
if (Get-Command codex -ErrorAction SilentlyContinue) {
  codex mcp remove nosorry *> $null
  codex mcp add nosorry -- node $mcp *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "MCP server registered in Codex (restart your agent to load it)" } else { Write-Host "Codex: run  codex mcp add nosorry -- node $mcp" }
}
$ErrorActionPreference = "Stop"
Write-Host "ready: nosorry problems --status open --unsolved"
`;
}

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const origin = await siteOrigin();
  const text = (body: string, type = "text/plain; charset=utf-8") =>
    new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
  if (rel === "install.sh") return text(installSh(origin));
  if (rel === "install.ps1") return text(installPs1(origin));
  const file = rel === "referee/SKILL.md" ? REFEREE : FILES[rel];
  if (!file) return new Response("not found", { status: 404 });
  try { return text(fs.readFileSync(path.join(process.cwd(), file), "utf8")); }
  catch { return new Response("skill file missing on this server (is skill/ in the deployed image?)", { status: 503 }); }
}
