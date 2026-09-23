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

📌 Team update (2026-09-23T09:15:46+0200): Focused account-release verification gate for the per-user isolation release is now in decisions.md — known checkpoint busy-response race must be fixed and pass before production; full 38-scenario browser suite is not certified (initial run 7 passed, 1 failed, 30 unrun) — decided by Squad Coordinator

- 2026-09-23T10:30:00+0200 (read-only New-career RCA): three request lifetimes, none stop the Node handler: ACA ingress 240 s (504, fixed on Consumption), EasyAuth sidecar HttpClient 600 s (logs 499), replica lifetime. KEDA trigger is `s0-upstream_rq_total` (request arrivals): scale-to-zero ~6–8 min after the last request even with a build in flight (07:11:07Z, 07:23:07Z verified; 9bn5l ~07:53Z inferred). Only new requests (polls, 409s count) keep the replica. Builds are SQL log-rate bound (log_write 94–100%, container 0.12–0.28 of 0.5 vCPU, peak 720 MiB/1 GiB); probes: readiness HTTP /api/health threshold 30×5 s + default TCP liveness/startup — no probe kills. System events are only reachable through `az containerapp logs show --type system` tail (no Log Analytics); capture early. Kiko-world advances failed 500 at 07:41:26Z (195.7 s) and 08:28:22Z (248.1 s). SQL Free: storage 2.5→14.4 GB in one morning without release; 59,592 vCore-s left 08:30Z; either monthly limit auto-pauses the DB until next calendar month.

- 2026-09-23T13:23+0200 (ship busy-fix part 1): commit e80e867 (17 files) on squad/new-career-busy-delete, PR #3 merged (merge commit) -> origin/main b15ceac (ls-remote verified). Release worktree touchline-account-release detached clean at b15ceac. Quiet window: 0 replicas, SQL CPU/log-write 0 since 10:19Z, DB idle-paused (not free-limit: 52,927 vCore-s, 11.6 GB). Pre-release backup BLOCKED: `data:export` login failed "server is not currently configured to accept this token" because the az CLI default subscription is now the corporate tenant (72f988bf); tedious `azure-active-directory-default` ignores the exported AZURE_TENANT_ID. `az ... --subscription` works for ARM, but SQL tokens follow the CLI default. Before any SQL operator step, check `az account show --query tenantId` == d588edc8-06a0-47ac-a9e6-aea06d1c6c25. Wrapper removed its firewall rule (0 touchline-operator rules), no partial file. Two portal QueryEditorClientIPAddress_* rules pre-exist (not ours, left untouched). Release worktree has no .env: last release loaded the main checkout's .env only in the child.

- 2026-09-23T13:58+0200 (ship busy-fix part 2): PR #3 (b15ceac, contains e80e867) was ALREADY live when this spawn started — an earlier run's first attempt died right after `[ingress] Closing existing ingress`, and a `=== RESUME 11:44:00Z ===` rerun in the same log finished rc=0 at 11:48:15Z. Did NOT redeploy. Live verification (13:57 local): revision touchline--d20260923114408-745686 Healthy, 100% traffic, image ghcr.io/carlossardo/touchline@sha256:30e12344…a4ef (tag local-b15ceac-…); previous d20260922173700 inactive; Multiple mode, scale 0..1, cooldown 300; /api/health 200; browser Accept -> 302 to login.microsoftonline.com/<tenant>; curl without Accept gets 401 (EasyAuth), anonymous /api/bootstrap and /api/saves 401; 0 operator firewall rules (161 script-managed touchline-app-<ip> egress rules remain, 2 portal rules untouched). Owner smoke still pending (skip-db-prepare). Learning: before launching a deploy, ALWAYS read the existing `.azure/reports/<name>.log` tail and `.touchline-deployment.json` recordedAt — a prior interrupted/resumed run may have already shipped. Also: shared VS Code terminals return other agents' output; write results to /tmp files and read them back.

📌 Team update (2026-09-23T13:56:00+0200): New-career busy fix + Delete career merged (PR #3, e80e867); pre-release dbo backup pre-release-20260923T112637Z.touchline.gz (sha256 821e33fe…); use carlos.sardo@outlook.com / sub 3373ab04… with temporary CLI default switch, restore afterwards — decided by Carlos Sardo, Squad
