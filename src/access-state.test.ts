/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  accessStateContent,
  signInHref,
  signOutAction,
} from "./access-state.ts";
import {
  ApiError,
  accessIssueFromFailure,
  isAccessIssueCode,
  type AccessIssueCode,
} from "./api-error.ts";

describe("accessStateContent", () => {
  it("asks a pending player to wait for an admin, with a check-again button and sign out", () => {
    const content = accessStateContent({ code: "access_pending" });

    expect(content.heading).toBe("Waiting for approval");
    expect(content.explanation).toMatch(/an admin approves every new player/);
    expect(content.actions).toEqual([
      { kind: "retry", label: "Check again", unchanged: "Not approved yet. Check again a little later." },
      { kind: "form", label: "Sign out", action: "/auth/logout" },
    ]);
  });

  it("tells a denied player that access was not granted and only offers sign out", () => {
    const content = accessStateContent({ code: "access_denied" });

    expect(content.heading).toBe("Access not granted");
    expect(content.actions).toEqual([
      { kind: "form", label: "Sign out", action: "/auth/logout" },
    ]);
  });

  it("keeps a retry and a wrong-account sign out for other refusals", () => {
    const content = accessStateContent({ code: "not_authorized" });

    expect(content.heading).toBe("You're not on the team sheet yet");
    expect(content.actions.map((action) => action.kind)).toEqual(["retry", "form"]);
    expect(content.actions[1]).toEqual({
      kind: "form",
      label: "Signed in with the wrong account?",
      action: "/auth/logout",
    });
  });

  it("offers sign-in back to the current page when the session has ended", () => {
    const content = accessStateContent(
      { code: "authentication_required" },
      "/#squad",
    );

    expect(content.heading).toBe("Sign in to continue");
    expect(content.actions).toEqual([{
      kind: "link",
      label: "Sign in",
      href: "/auth/login?returnTo=%2F%23squad",
    }]);
    expect(signOutAction).toBe("/auth/logout");
  });

  it("never mentions invites or a specific identity provider", () => {
    const codes: AccessIssueCode[] = [
      "authentication_required",
      "access_pending",
      "access_denied",
      "not_authorized",
    ];
    for (const code of codes) {
      const text = JSON.stringify(accessStateContent({ code }));
      expect(text).not.toMatch(/microsoft|invite|outlook|hotmail/i);
    }
  });

  it("builds sign-in links only for same-origin paths", () => {
    expect(signInHref()).toBe("/auth/login");
    expect(signInHref("/")).toBe("/auth/login");
    expect(signInHref("/admin?x=1")).toBe("/auth/login?returnTo=%2Fadmin%3Fx%3D1");
    expect(signInHref("//evil.example/")).toBe("/auth/login");
    expect(signInHref("https://evil.example/")).toBe("/auth/login");
  });

  it("recognises only the access-related API failures", () => {
    expect(isAccessIssueCode("access_pending")).toBe(true);
    expect(isAccessIssueCode("invite_required")).toBe(false);
    expect(isAccessIssueCode("capacity_unavailable")).toBe(false);
    expect(
      accessIssueFromFailure(
        new ApiError("Waiting", 403, { code: "access_pending" }),
      ),
    ).toEqual({ code: "access_pending", status: 403, message: "Waiting" });
    expect(
      accessIssueFromFailure(
        new ApiError("Denied", 403, { code: "access_denied" }),
      ),
    ).toMatchObject({ code: "access_denied", status: 403 });
    expect(
      accessIssueFromFailure(
        new ApiError("Refused", 403, { code: "not_authorized" }),
      ),
    ).toMatchObject({ code: "not_authorized", status: 403 });
    expect(
      accessIssueFromFailure(new ApiError("Busy", 409, { code: "world_busy" })),
    ).toBeNull();
    expect(
      accessIssueFromFailure(new ApiError("Forbidden", 403)),
    ).toBeNull();
    expect(
      accessIssueFromFailure(
        new ApiError("Signed out", 401, { code: "authentication_required" }),
      ),
    ).toMatchObject({ code: "authentication_required", status: 401 });
    expect(
      accessIssueFromFailure(
        new ApiError("Wrong status", 403, { code: "authentication_required" }),
      ),
    ).toBeNull();
    expect(
      accessIssueFromFailure(
        new ApiError("Wrong status", 401, { code: "access_pending" }),
      ),
    ).toBeNull();
    expect(
      accessIssueFromFailure(
        new ApiError("Wrong status", 503, { code: "access_denied" }),
      ),
    ).toBeNull();
  });

  it("clears stale access issues after a successful session retry", async () => {
    const source = await readFile(new URL("./game-context.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/setSession\(nextSession\);\s+setError\(null\);\s+setAccessIssue\(null\);\s+setLoading\(false\);\s+enterBusy/s);
    expect(source).toMatch(/setBootstrap\(result\);\s+bootstrapRef\.current = result;\s+setError\(null\);\s+setAccessIssue\(null\);\s+setLoading\(false\);/s);
  });
});
