# KD Code

<div align="center">
  <img src="./docs/assets/banner.png" alt="KD Code Architecture Banner" width="100%" />
</div>

<br />

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/Node.js-22+-green.svg)
![Effect](https://img.shields.io/badge/Effect--TS-Strict-blue.svg)
![DB](<https://img.shields.io/badge/Database-PostgreSQL%20(pgvector)-lightgrey.svg>)

> **Developer workbench and AI control plane: switch seamlessly between Claude, Gemini, and local models without ever losing project context or architectural state.**

**KD Code** is the developer workbench and agentic IDE control plane for the KruschDev ecosystem. Acting as the visual command deck, it seamlessly couples with the **Krusch Pre-Router** (L1 fast syntactic gate), **Krusch Cascade Router** (multi-specialist agent delegation), and **Krusch Context MCP** (PostgreSQL-backed episodic memory and symbol graph).

By aggressively decoupling the frontend UI from a heavy local filesystem and SQLite constraints, Krusch DBOS treats a stateless PostgreSQL instance as its central "nervous system." This enables multiple workers to autonomously plan, execute, and verify code concurrently across multiple edge nodes without lock contention or context degradation.

## 🧠 Why a Database Operating System (DBOS)?

Traditional IDEs and AI coding assistants are fundamentally local, single-player applications. When they execute tasks, their state is highly volatile—living in application memory or a synchronous local file like SQLite. If you attempt to spin up multiple AI agents simultaneously to conquer different domains of a massive codebase, they violently collide: tripping over file locks (`SQLITE_BUSY`), hallucinating due to out-of-sync context, and ultimately crashing the application.

Krusch DBOS completely transforms the IDE from a fragile, single-player text editor into a **distributed agentic engine**. By migrating orchestration logic out of ephemeral memory and into a highly robust, transactional relational database (PostgreSQL), the database itself operates as the state machine and message bus. Every agent's thought process, tool execution, and architectural plan becomes a persistent, ACID-compliant database transaction.

### Why the Hard Fork?

The original Krusch DBOS repository was built as an impressive, single-user desktop application. However, as it evolved, two major architectural blockers emerged that necessitated a hard fork:

1. **The Concurrency Problem:** The original architecture relied on an in-memory Node.js loop and a local SQLite instance for its execution engine. While fast for a single agent, this approach becomes incredibly brittle under heavy concurrency. Attempting to run multiple agents simultaneously led to fiber leakage, lock contention (`SQLITE_BUSY`), and UI desynchronization.
2. **The Scope Creep Purge:** Krusch DBOS's primary value proposition is being a rock-solid, core IDE connecting developers with powerful AI models (Codex, Claude, Cursor, Gemini). Experimental agentic features (like Chrysalis Swarm, Google ADK, and LangGraph integrations) began introducing significant "scope creep." The UI became cluttered, and routing logic grew overly complex.

**The DBOS Pivot:**
Krusch DBOS hardforks the traditional architecture to establish a strict separation of concerns and introduce four foundational pillars:

- **The Pristine Base Platform**: All experimental agentic logic has been purged from the core build. In the future, complex external agents will be built as standalone extensions that hook into the DBOS queue via Server-Sent Events (SSE), keeping the core repository clean.
- **Dual-Embedded Database Architecture**: Solves the historical bottleneck of UI hydration and project lock contention. It uses a **global PostgreSQL Orchestrator** (for stateless JSONB queuing and multi-node job dispatch) alongside a **local SQLite workspace per-project** (for isolated code chunk storage and projection snapshots).
- **Postgres `SKIP LOCKED` Queuing**: Obliterates synchronous, lock-heavy SQLite bottlenecks in favor of highly-concurrent, lock-free PostgreSQL job queues. This ensures thousands of events can be processed simultaneously safely out-of-process.
- **True Stateless Decoupling**: The UI is now a lightweight, completely stateless "thin client" (accessible via any modern web browser or Electron wrapper), while the Heavy Server engine runs independently on headless compute nodes.

### What critical bottlenecks does this solve?

1. **State Loss & Resilience Failures**: In traditional AI tooling, a UI crash or a closed laptop lid destroys the agent's context and execution state instantly. In Krusch DBOS, every atomic step is persisted to the database. If a compute node loses power, the active transaction is cleanly rolled back, and the `SKIP LOCKED` queue automatically releases the job for another edge worker to immediately resume.
2. **Native Transactional Tool Execution**: DBOS agents no longer rely on brittle IDE communication protocols for basic tool usage. The `AgentExecutionEngine` natively processes `EXECUTE_TOOLS` queue payloads to modify the local filesystem and spawn bash commands directly on the server, streaming standard outputs natively into the persistent event log.
3. **Local Compute Starvation**: Running heavy local LLM inference or generating large RAG vector embeddings drains laptop batteries and throttles development workflows. DBOS allows you to fully offload heavy orchestration, vector math, and database lifting to dedicated servers or cloud GPUs.
4. **Context Amnesia ("Goldfish Memory")**: Long-running projects inevitably cause AI agents to forget early architectural decisions. DBOS natively integrates an asynchronous `VectorEmbeddingWorker` powered by `pgvector`, allowing agents to semantically query and inject exact quotes from their entire historical session memory directly into their prompt context.
5. **Self-Healing Agent Loops (HALO)**: DBOS natively integrates a localized implementation of the **[Hierarchical Agent Loop Optimizer (HALO)](https://github.com/context-labs/halo)** framework. A background worker continuously sweeps execution traces using a local Ollama LLM (`llama3.1`) to identify systemic agent failures or repeating errors. It synthesizes these into behavioral "Nuggets" which are natively vectorized and stored locally to gently steer future agent logic without manual intervention.

### 🧠 Cross-IDE Local Persistent Memory

Traditional IDE agents suffer from "Goldfish Memory"—closing your laptop or switching machines wipes their conversational context. Krusch DBOS solves this by anchoring all agent memory to a robust, cross-platform PostgreSQL vector database (`pgvector`), enhanced with **temporal decay** to ensure newer architectural decisions naturally outrank older ones.

- **Cross-Provider Semantic Recall:** Every conversation, architectural decision, and shell command is vectorized using a unified embedding model and stored locally in PostgreSQL. Because context injection happens at the database layer, an architectural decision made by Gemini today can be instantly recalled and utilized by Claude or Codex tomorrow.
- **Native Project-Level Isolation ("Nesting Structure"):** Instead of a flat global index, semantic recall operates on a strict multi-tenant project basis. DBOS natively traces AI threads back to their source project and applies project-specific filtering during vector searches. This strict isolation prevents cross-project context bleed, ensuring that an AI agent reasoning about one project won't hallucinate architectural details from another, while still retaining access to global system context.
- **Dynamic Embedding Providers:** Choose your preferred embedding engine directly from the UI settings. The architecture supports local-first privacy (Ollama), high-performance cloud APIs (OpenAI/Gemini), or completely disabling semantic recall ("none"), giving you full control over privacy and inference compute.
- **Cross-IDE Memory with MCP:** Because the DBOS PostgreSQL database acts as the single source of truth, you can connect the [krusch_memory_mcp](https://github.com/kruschdev/krusch_memory_mcp) server to your other editors (like Claude Desktop or Cursor). This enables true **Cross-IDE Semantic Recall**—an architectural decision made by an agent in Krusch DBOS can be instantly semantically recalled by a different agent running in Cursor, completely breaking down the walls between your AI assistants.
- **Write Once, Remember Everywhere:** Because state is pushed out of the ephemeral UI and into the database, you can start an architectural discussion on your desktop PC, switch to your laptop's web browser, and have the agent seamlessly continue reasoning without missing a beat.
- **Zero-Resource Edge Syncing:** The heavy lifting of creating vector embeddings and performing similarity searches is offloaded to the DBOS backend. Your thin-client UI (whether Electron or web-based) remains ultra-lightweight while harnessing a massive, persistent knowledge graph.

## ✨ Core Capabilities

Out of the box, **Krusch DBOS functions as a standard, high-performance coding workspace.** You can use it as a direct replacement for single-player IDE assistants (like standard Claude or Codex), leveraging its robust PostgreSQL state management simply to keep your history persistent and lock-free.

## 🤖 Supported AI Providers & Agents

Krusch DBOS supports a diverse ecosystem of AI models and multi-agent systems. You can hot-swap providers via the UI depending on your current task:

- **Google Gemini**: Full support for `gemini-3.1-pro` and flash variants.
- **Anthropic Claude**: First-class integration for Claude 3 Opus and Sonnet models.
- **OpenAI / Codex**: Standard GPT-4 execution and compatible API endpoints.
- **Cursor & OpenCode**: Native IDE-agent style completions and RAG routing.

### Local LLM Support (Ollama & llama.cpp)

Yes, Krusch DBOS fully supports local inference:

1. **Local Vector Embeddings**: DBOS natively uses **Ollama** under the hood (via the `OLLAMA_URL` environment variable) to run models like `nomic-embed-text`. This is what powers the `VectorEmbeddingWorker`, ensuring your semantic session memories are written to `pgvector` entirely locally and privately.
2. **Local Code Generation**: While heavy lifting is often offloaded to cloud providers, you can effortlessly point the OpenAI/Codex provider endpoint to a local **Ollama** or **llama.cpp** OpenAI-compatible server. This allows you to run models like Llama 3, DeepSeek-Coder, or Qwen natively.

### Under the Hood: Wrapping the Coding CLIs

One of the most powerful features of Krusch DBOS is how it powers its unified thin-client UI. Rather than reinventing the wheel, the backend natively wraps the official "Coding CLIs" and agent SDKs from Anthropic, OpenAI, and Google:

- It spawns and manages headless execution processes using packages like `@anthropic-ai/claude-agent-sdk` and `@opencode-ai/sdk`.
- The DBOS adapters (`ClaudeAdapter`, `CodexAdapter`, `OpenCodeAdapter`) intercept the raw stdout, telemetry, and filesystem permission requests from these CLIs.
- It normalizes these disparate SDK streams into a standardized event model (`ProviderRuntimeEvent`) and pipes them over WebSockets.

This means you get the full, raw power of the official Claude, Codex, and Gemini coding agents, but controlled entirely through a sleek, unified graphical interface.

## ⚡ Quick Start

### Prerequisites

- Node.js & Bun (`bun >= 1.0.0`)
- Docker & Docker Compose (for the PostgreSQL + `pgvector` database)

### 1. Boot the Database Layer

```bash
docker compose up -d
```

### 2. Install & Bootstrap

```bash
bun install
# Run database migrations and bootstrap schema
bun run dev:server --migrate
```

### 3. Start the Development Server

```bash
bun run dev
```

---

## 🛠️ Configuration

Krusch DBOS supports advanced external configuration for thin clients and distributed architectures. A template has been provided in `.env.example`. Make a copy named `.env` and configure accordingly:

- **`DATABASE_URL`**: Primary PostgreSQL connection string (e.g., `postgres://t3code:password@db:5432/t3code` when running inside a Docker network, or `localhost` if running outside).
- **`GEMINI_API_KEY`** & **`OLLAMA_URL`**: Provider and local embedding configurations used by the RAG context utilities.
- **`VITE_HTTP_URL`** & **`VITE_WS_URL`**: Absolute connection strings for desktop/web thin clients communicating with a remote DBOS backend.

---

## 💻 CLI Support

Krusch DBOS includes a powerful, native Command Line Interface (`t3`) built to dispatch orchestration tasks and manage headless deployments.

You can access the CLI via the binary or development script:

```bash
bun run apps/server/src/bin.ts --help
```

### Core Subcommands

- `start`: Runs the Krusch DBOS server in standard mode.
- `serve`: Runs the Krusch DBOS server headlessly (without opening a browser) and outputs pairing details. Ideal for remote edge nodes or Dockerized deployments.
- `auth`: Manages the local auth control plane.
  - `auth pairing`: Generate and manage one-time client pairing tokens to securely connect remote thin clients.
  - `auth session`: Manage long-lived bearer sessions and TTLs.
- `project`: Natively dispatch project management commands directly into the DBOS queues.
  - `project add`, `project remove`, `project rename`: Mutate project metadata and synchronize the persistence layer without needing the web UI.

The CLI acts as a first-class DBOS client. It dispatches the exact same `ClientOrchestrationCommand` events as the web interface, ensuring perfect ACID state synchronization.

---

## 🗄️ API & Connectivity Layer

The backend heavily decouples the core logic by exposing both HTTP and WebSocket interfaces, transforming it into a true DBOS engine.

### WebSocket Engine (`ws.ts`)

The `WS_METHODS` and `ORCHESTRATION_WS_METHODS` RPC layers power real-time DBOS operations over `effect/unstable/rpc`:

- **`dispatchCommand`**: Safely appends commands (e.g. `thread.turn.start`) into the PostgreSQL queues.
- **`subscribeShell`** / **`subscribeThread`**: Streams materialized Postgres `ProjectionThread` snapshots and live domain events natively to thin clients.
- **`replayEvents`**: Fetches and rehydrates historical events directly from the DBOS persistent store.

### HTTP Endpoints (`http.ts`)

- `GET /.well-known/t3/environment`: Emits public server configuration and capabilities.
- `POST /api/observability/v1/traces`: Ingests OTLP browser traces and proxies them securely to the backend tracing engine.
- `GET /attachments/*`: Authenticated immutable storage retrieval for generated assets and RAG context artifacts.
- `GET /*`: Thin client asset delivery and dev-server traffic routing.

---

## 🏗️ Architecture

For a deep dive into the DBOS queuing model and sequence diagrams, please read [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 🤝 Contributing

We welcome contributions! Whether it's adding new AI providers, optimizing the Postgres queuing, or refining the UI, please feel free to open PRs.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
