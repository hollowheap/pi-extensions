# Architectural Brainstorm: Web Search & Sandbox Execution

Status: Draft for Review  
Date: 2026-10-27  
Scope: Keyless Web Search Architecture (`pi-web`) & Execution Sandboxing (`pi-sandbox` / Podman)

---

## 1. Problem Space & Context

### 1.1 Web Search (`pi-web`)
- **Current State**: [`extensions/pi-web`](file:///home/hollowheap/repos/my-pi-agent/extensions/pi-web) provides `web_search` and `web_fetch`.
  - `web_fetch` already supports keyless operation via the `raw HTTP` fallback using Node's `fetch()`.
  - `web_search` currently mandates at least one commercial provider key (`EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`). Without keys, `resolveSearchOrder()` returns an empty list, immediately throwing `web_search error: no configured search provider has an API key`.
- **Mode Permissions**: In [`packages/core/src/modes.ts:32-36`](file:///home/hollowheap/repos/my-pi-agent/packages/core/src/modes.ts#L32-L36), `ask` mode defaults are `{ read: "allow", search: "allow", edit: "ask", shell: "ask" }`. `web_search` is tagged `search` and `web_fetch` is tagged `read`. The tools are already allowed by policy; the failure is strictly a lack of a keyless provider adapter.

### 1.2 Execution Sandboxing
- **Current State**: The agent executes bash commands ([`bash`](file:///home/hollowheap/repos/my-pi-agent/packages/core/src/shell.ts)) and durable background tasks ([`extensions/pi-tasks`](file:///home/hollowheap/repos/my-pi-agent/extensions/pi-tasks)) directly on the host system with the current user's privileges.
- **Environment Facts**:
  - Host OS: Linux (NixOS).
  - Podman is installed (`/run/current-system/sw/bin/podman`) and verified running in **rootless** mode (`podman info --format '{{.Host.Security.Rootless}}'` -> `true`).
  - Docker is also installed (`/run/current-system/sw/bin/docker`).
  - Bubblewrap (`bwrap`) is not installed on the system PATH.

---

## 2. Keyless Web Search: Architectural Archetypes

### Archetype S1: Built-in DuckDuckGo HTML Fallback in `pi-web`
- **Mechanism**: Implement a lightweight DuckDuckGo HTML parser adapter (`extensions/pi-web/src/providers/duckduckgo.ts`) using standard Node.js `fetch()` querying `https://html.duckduckgo.com/html/?q=...`.
- **Integration**: Append `"duckduckgo"` (or `"ddg"`) to the default `SEARCH_ORDER = ["exa", "tavily", "firecrawl", "duckduckgo"]`. It requires no API key (`hasProviderKey("duckduckgo") === true`).
- **Feasibility Verification**: Verified via [`artifacts/scripts/probe-ddg.mjs`](file:///home/hollowheap/repos/my-pi-agent/artifacts/scripts/probe-ddg.mjs) (returns 200 OK with parsed search results in under 400ms without API tokens).
- **Pros**:
  - Zero external dependencies; zero config required out-of-the-box.
  - Seamless fallback: uses commercial providers if keys exist; gracefully drops to DuckDuckGo when keys are omitted.
  - Consistent normalized output schema (`title`, `url`, `snippet`, `provider: "duckduckgo"`).
- **Cons & Failure Modes**:
  - HTML structure changes could break parsing if not resilient.
  - Aggressive automated scraping can trigger rate limits or CAPTCHA challenges from DuckDuckGo.

### Archetype S2: Configurable Metasearch Engine / SearXNG Endpoint
- **Mechanism**: Introduce an open-standard JSON metasearch adapter querying a user-specified SearXNG or Whoogle instance (`https://searx.example.com/search?format=json&q=...`).
- **Configuration**: Configured via `SEARXNG_URL` or `<agentDir>/web.json`.
- **Pros**:
  - Clean, stable JSON API schema designed for machine queries.
  - Avoids HTML scraping fragility.
  - Self-hostable for strict privacy.
- **Cons & Failure Modes**:
  - Not zero-config: requires the user to either host an instance or select a public SearXNG instance (many public instances disable JSON format or apply Cloudflare blocks).
  - High friction for typical users who just want `web_search` to work out-of-the-box.

### Archetype S3: Search CLI Subprocess Delegation (e.g. `ddgr` / `w3m`)
- **Mechanism**: Spawn an external host binary (e.g., `ddgr -n 5 --json`) to retrieve results.
- **Pros**:
  - Offloads parsing and anti-bot mitigation to dedicated upstream CLI tools.
- **Cons & Failure Modes**:
  - Violates repo dependency and portability conventions (requires external package installation).
  - Introduces subprocess overhead and shell injection attack surfaces.
  - Inconsistent cross-platform availability.

### Trade-Off Matrix: Web Search

| Criterion | S1: DuckDuckGo HTML Fallback | S2: SearXNG JSON Adapter | S3: CLI Subprocess (`ddgr`) |
|---|---|---|---|
| **Zero-Config Usability** | **High** (works immediately) | Low (requires URL setup) | Medium (requires binary) |
| **Coupling & Portability** | **High** (pure Node `fetch`) | High (pure Node `fetch`) | Low (external host CLI) |
| **Schema Stability** | Medium (HTML structure) | **High** (standard JSON API) | Medium (CLI output format) |
| **Blast Radius** | **Minimal** (internal `pi-web` adapter) | Minimal (internal adapter) | Medium (spawns child process) |
| **YAGNI Compliance** | **High** (satisfies keyless need) | Medium (speculative hosting) | Low (unnecessary indirection) |

---

## 3. Sandboxing Architecture: Architectural Archetypes

### Archetype K1: Whole-Process Containerization (`Dockerfile.pi` + Podman Run)
- **Mechanism**: The user starts the Pi agent inside an isolated rootless container. A `Dockerfile.pi` builds a container image containing Node 22/24 and `@earendil-works/pi-coding-agent`, with a CLI launcher script (`bin/pi-container`).
  ```bash
  podman run --rm -it \
    -v "$PWD:/workspace:z" \
    -v pi-agent-home:/root/.pi/agent:z \
    -e ANTHROPIC_API_KEY \
    localhost/pi-sandbox
  ```
- **Seams**: Zero changes to Pi core packages or extensions. All tools run natively inside the container.
- **Pros**:
  - Complete hermetic security boundary: host filesystem, SSH keys, dotfiles, and system services are completely isolated.
  - Upstream official pattern documented in Pi’s containerization guide.
  - Zero code maintenance in `@hollowheap/*` packages.
- **Cons & Failure Modes**:
  - TUI limitations: Host clipboard, notification daemons, or hardware cursor protocols require specialized container pass-through.
  - Workspace file permission mismatches if UID mapping is misconfigured.
  - Cannot access host developer tools (e.g., system Git credentials, host language servers) without bind-mounting them into the container.

### Archetype K2: Selective Tool Sandboxing Extension (`pi-sandbox` with Podman Exec)
- **Mechanism**: Pi runs natively on the host machine (preserving native TUI, host terminal ergonomics, Git signing, and editor integration). A new extension (`extensions/pi-sandbox`) registers an execution interceptor for `bash` and `task` tool calls, spawning commands inside a background rootless Podman container:
  `podman exec -i <session-container-id> bash -c "<command>"`
- **Seams**: Intercepts `tool_call` before execution or provides an alternative sandboxed execution runner implementing Pi's `BashOperations`.
- **Pros**:
  - Native user experience: Full access to host clipboard, native TUI styling, host model credentials, and local extension configurations.
  - Strong command containment: Potentially destructive model actions (`rm -rf`, curl pipelines, untrusted dependencies) execute strictly inside the container.
  - Seamless project mounting: Project directory is mounted into the container at `/workspace`.
- **Cons & Failure Modes**:
  - Partial boundary: Only covers tools handled by the interceptor; host-level filesystem tools (`read`, `write`) remain on host unless also gated or proxied.
  - Container lifecycle management: Needs automatic container spawning, health checking, and cleanup on session termination.

### Archetype K3: Bubblewrap (`bwrap`) OS-Level Sandbox
- **Mechanism**: Intercept bash commands and prepend `bwrap --ro-bind / / --bind $PWD $PWD --dev /dev --proc /proc ... bash -c ...`.
- **Pros**:
  - Extremely fast startup (<10ms) without container image overhead.
- **Cons & Failure Modes**:
  - `bwrap` is **not installed** on the host system (`which: no bwrap in PATH`).
  - Requires Linux kernel unprivileged user namespaces and distribution package installation.

### Trade-Off Matrix: Sandboxing

| Criterion | K1: Whole-Process Container (Podman) | K2: Tool Sandboxing Extension (Podman) | K3: Bubblewrap (`bwrap`) |
|---|---|---|---|
| **Security Boundary** | **Maximum** (entire agent contained) | High (commands isolated) | High (OS namespaces) |
| **Host TUI / UX Ergonomics** | Medium (terminal pass-through) | **Maximum** (host native TUI) | High (host native TUI) |
| **Host System Availability** | **Ready** (`podman` rootless available) | **Ready** (`podman` rootless available) | **Blocked** (`bwrap` missing) |
| **Implementation Complexity** | **Low** (`Dockerfile` + launcher script) | Medium (extension lifecycle & exec) | Medium (bwrap CLI args) |
| **YAGNI Compliance** | **High** (uses built-in upstream pattern) | Medium (custom container manager) | Low (requires package install) |

---

## 4. Recommended Directions & Decisions to Frame

### Recommendation 1: Web Search
Adopt **Archetype S1 (DuckDuckGo HTML Fallback)** for `pi-web`:
1. Add `extensions/pi-web/src/providers/duckduckgo.ts` as a keyless fallback adapter.
2. Update `SEARCH_ORDER = ["exa", "tavily", "firecrawl", "duckduckgo"]`.
3. If no commercial API keys are present, search seamlessly falls through to DuckDuckGo, giving immediate out-of-the-box search in `ask` mode without throwing configuration errors.

### Recommendation 2: Sandboxing
Adopt a two-tier strategy:
1. **Immediate / Standard (Archetype K1)**: Provide a standardized, reproducible `Dockerfile.pi` and rootless `bin/pi-podman` runner script adhering to Pi containerization specifications.
2. **Advanced Extension (Archetype K2)**: If in-process host TUI preservation is preferred over whole-process isolation, define a dedicated `pi-sandbox` package in a future milestone.
