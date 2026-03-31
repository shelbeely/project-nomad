# About Project N.O.M.A.D.

Project N.O.M.A.D. (Node for Offline Media, Archives, and Data; "Nomad" for short) is a project started in 2025 by Chris Sherwood of [Crosstalk Solutions, LLC](https://crosstalksolutions.com). The goal of the project is not to create just another utility for storing offline resources, but rather to allow users to run their own ultimate "survival computer".

While many similar offline survival computers are designed to be run on bare-minimum, lightweight hardware, Project N.O.M.A.D. is quite the opposite. To install and run the available AI tools, we highly encourage the use of a beefy, GPU-backed device to make the most of your install. See the [Hardware Guide](https://www.projectnomad.us/hardware) for detailed build recommendations at three price points.

Since its initial release, NOMAD has grown to include built-in AI chat with a Knowledge Base for document-aware responses, a System Benchmark with a community leaderboard, curated content collections with tiered options, and an Easy Setup Wizard to get new users up and running quickly.

This fork of the upstream [Crosstalk Solutions project-nomad](https://github.com/Crosstalk-Solutions/project-nomad) extends the platform with an **agent-first architecture**: every NOMAD capability is now exposed as a callable tool via an MCP JSON-RPC 2.0 endpoint (`/mcp`), an OpenAI-compatible inference API (`/v1`), and a REST agent API (`/api/agent/*`). New additions include:

- **Agent Console** — browser UI for running autonomous AI agents and exploring MCP tools interactively
- **Wiki Tools** — five MCP tools (`nomad_search_wikipedia`, `wiki_open_article`, `wiki_open_section`, `wiki_quote_passages`, `wiki_verify_claim`) for deep offline Wikipedia access by AI agents
- **Internet Archive Mirror** — browse and cache books, audio, video, and historical documents from the Internet Archive offline
- **OpenRouter Support** — route AI inference through cloud models when local hardware isn't available
- **OpenClaw Integration** — optional sibling container that runs an autonomous AI agent on the same Docker network as NOMAD, with full access to all MCP tools
- **Optional API Key Auth** — protect agent/MCP/v1 routes with `NOMAD_API_KEY`

Project N.O.M.A.D. is open source, released under the [Apache License 2.0](https://github.com/Crosstalk-Solutions/project-nomad/blob/main/LICENSE).

## Links

- **Website:** [www.projectnomad.us](https://www.projectnomad.us)
- **Hardware Guide:** [www.projectnomad.us/hardware](https://www.projectnomad.us/hardware)
- **Discord:** [Join the Community](https://discord.com/invite/crosstalksolutions)
- **GitHub:** [Crosstalk-Solutions/project-nomad](https://github.com/Crosstalk-Solutions/project-nomad)
- **Benchmark Leaderboard:** [benchmark.projectnomad.us](https://benchmark.projectnomad.us)
