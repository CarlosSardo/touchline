---
title: Identity and access
description: OIDC sign-in, approval, schema routing and the boundaries protecting private careers.
---

# Identity and access

Touchline distinguishes three questions: **who signed in**, **whether they are approved**, and **which world they own**. Treating an email address, director name or selected schema as an answer to all three breaks the design.

## Authentication

`server/auth.ts` integrates an operator-owned OIDC provider through `openid-client`. The hosted flow is Authorization Code with PKCE, state and nonce validation; token validation checks issuer, audience and signature, and UserInfo enriches relevant profile/group claims.

The provider proves identity. The durable key is `(issuer, subject)`, not email, username or display name. Authelia is the documented reference provider, not a required extra container in the Touchline stack.

Sessions are expiring HMAC-signed cookies with separate purpose-derived signing keys for the login transaction and session. Cookies use HttpOnly, SameSite=Lax and Secure in hosted mode, including a `__Host-` session name. Signed is not encrypted: do not treat cookie contents as secret storage.

`APP_ORIGIN` is an exact HTTPS origin and `TRUST_PROXY` describes the trusted reverse-proxy boundary. API mutations enforce same-origin requests; browser resource access also goes through session guards. OIDC/login behavior is not delegated to an arbitrary proxy-injected identity header.

## Authorization and approval

The provider's `ADMIN_GROUP` membership grants administrative status for the signed-in identity. That status is not inferred from a world profile or a stored sporting-director name.

A non-admin's first sign-in records a pending access request and shows a waiting screen. An admin approves or denies at `/admin`. Approval holds the registry lock and creates the user, unique world schema and migrations atomically, subject to player-count and database-size guards. An already-approved request is idempotent.

An admin's initial account provisions automatically. Accounts receive empty schemas; users then choose/start careers. Deleting a career is not deleting the identity or revoking access.

Provider disablement stops future sign-ins, but existing Touchline cookies remain valid until expiry. There is no in-app immediate session revocation mechanism. Operators must account for that delay when changing access.

The current API requires a positive `MAX_PLAYERS`; the older example's `0`/admins-only comment does not match the parser. Consult the [configuration runbook](https://github.com/CarlosSardo/touchline/blob/main/DEVELOPMENT.md#configuration) rather than assuming zero is accepted.

## World routing and isolation

`Accounts.resolve()` validates the registry entry and registered world, obtains a schema-scoped `Store`, and returns it to `app.ts`. World routers are keyed by database/schema; the browser never chooses a target schema. Missing worlds, schema collisions and reassignment fail closed.

Save IDs and account/world identifiers supplied in requests do not establish ownership. SQL queries execute against the resolved store; human account profile data remains separate from the fictional director.

The browser resets resource/request generations on account changes so stale responses cannot populate a new session. World replacement invalidates server resource/policy caches as well.

Isolation is implemented by application routing plus SQL schema/lock discipline under one application role. It is not a claim of separate PostgreSQL users, RLS or hardened multi-tenant infrastructure against application-role compromise.

## Local development is a different trust mode

Without hosted sign-in, listener, peer and host/origin checks restrict local access to loopback. A non-loopback listener refuses to start without explicit hosted authentication. Docker's internal `0.0.0.0` listener still requires real authentication even if its published host port is loopback-only.

Synthetic test identities and a local supplied Store make tests practical but do not validate real provider discovery, proxy TLS, callback handling, cookie behavior or approval isolation on the host. Those require environment-specific verification.

For provider setup, secrets, approval and recovery procedures, use [Sign-in and access](https://github.com/CarlosSardo/touchline/blob/main/DEVELOPMENT.md#sign-in-and-access).
