# Squad Team

> Touchline - a football sporting-director simulation game.

## Coordinator

| Name | Role | Notes |
| --- | --- | --- |
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
| --- | --- | --- | --- |
| Lead | Game Systems Lead | `.squad/agents/lead/charter.md` | Active |
| Product | Product/UI Engineer | `.squad/agents/product/charter.md` | Active |
| Data | Data/Platform Engineer | `.squad/agents/data/charter.md` | Active |
| Cloud | Azure Cloud Specialist | `.squad/agents/cloud/charter.md` | Active |
| Scribe | Session Logger & Memory Manager | `.squad/agents/scribe/charter.md` | Silent |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | Monitor |
| Rai | RAI Reviewer | `.squad/agents/Rai/charter.md` | Background |
| Fact Checker | Verification Agent | `.squad/agents/fact-checker/charter.md` | Verifier |

## Coding Agent

<!-- copilot-auto-assign: false -->

| Name | Role | Charter | Status |
| --- | --- | --- | --- |
| @copilot | Coding Agent | — | 🤖 Coding Agent |

### Capabilities

**🟢 Good fit — auto-route when enabled:**

- Bug fixes with clear reproduction steps
- Test coverage (adding missing tests, fixing flaky tests)
- Lint/format fixes and code style cleanup
- Dependency updates and version bumps
- Small isolated features with clear specs
- Boilerplate/scaffolding generation
- Documentation fixes and README updates

**🟡 Needs review — route to @copilot but flag for squad member PR review:**

- Medium features with clear specs and acceptance criteria
- Refactoring with existing test coverage
- API endpoint additions following established patterns
- Migration scripts with well-defined schemas

**🔴 Not suitable — route to squad member instead:**

- Architecture decisions and system design
- Multi-system integration requiring coordination
- Ambiguous requirements needing clarification
- Security-critical changes (auth, encryption, access control)
- Performance-critical paths requiring benchmarking
- Changes requiring cross-team discussion

## Project Context

- **Owner:** Carlos Sardo
- **Project:** Touchline
- **Stack:** TypeScript, React, Vite, Node.js, Express, SQL Server/Azure SQL, Vitest, Playwright, Docker, Azure Container Apps, Microsoft Entra ID
- **Description:** A realism-focused football sporting-director game with private careers, persistent worlds, and production hosting on Azure.
- **Created:** 2026-09-22
