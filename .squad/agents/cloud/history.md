# Project Context

- **Owner:** Carlos Sardo
- **Project:** Touchline, a realism-focused football sporting-director simulation game
- **Stack:** Docker, Azure Container Apps, Azure SQL, Microsoft Entra ID, managed identities, Node.js/TypeScript, CI/CD
- **Created:** 2026-09-22

## Core Context

Cloud owns Azure provisioning and operations, deployments, identity and secrets, networking, observability, reliability, backup and rollback, and cost controls. Important surfaces include `Dockerfile`, `.azure/`, `.github/workflows/`, and `scripts/azure-*.sh`.

## Learnings

- Container health must be verified through the public user path as well as the platform health endpoint.
- Production changes need narrow privileges, explicit backup/rollback gates, and post-deployment evidence.
