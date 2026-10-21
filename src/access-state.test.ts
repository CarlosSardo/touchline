/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  accessStateContent,
  microsoftAccountReminder,
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
  it("routes 403 access codes to the invite request screen", () => {
    const codes: AccessIssueCode[] = [
      "invite_required",
      "account_not_provisioned",
      "not_authorized",
    ];

    for (const code of codes) {
      const content = accessStateContent({ code });
      expect(content.heading).toBe("You're not on the team sheet yet");
      expect(content.primary).toEqual({
        label: "Request an invite",
        href: "/invite",
      });
      expect(content.secondary).toEqual({
        label: "Signed in with the wrong account?",
        action: "/auth/logout",
      });
      expect(content.reminder).toBe(microsoftAccountReminder);
    }
  });

  it("explains capacity without sending the player back through invite request", () => {
    const content = accessStateContent({ code: "capacity_unavailable" });

    expect(content.heading).toBe("Touchline is full right now");
    expect(content.explanation).toBe(
      "Touchline is full right now — your invite is safe; try again later.",
    );
    expect(content.primary).toBeUndefined();
    expect(content.secondary.label).toBe("Signed in with the wrong account?");
  });

  it("offers sign-in back to the current page when the session has ended", () => {
    const content = accessStateContent(
      { code: "authentication_required" },
      "/#squad",
    );

    expect(content.heading).toBe("Sign in to continue");
    expect(content.primary).toEqual({
      label: "Sign in",
      href: "/auth/login?returnTo=%2F%23squad",
    });
    expect(content.secondary).toEqual({ label: "Request an invite", href: "/invite" });
    expect(signOutAction).toBe("/auth/logout");
  });

  it("builds sign-in links only for same-origin paths", () => {
    expect(signInHref()).toBe("/auth/login");
    expect(signInHref("/")).toBe("/auth/login");
    expect(signInHref("/admin/invites?x=1")).toBe("/auth/login?returnTo=%2Fadmin%2Finvites%3Fx%3D1");
    expect(signInHref("//evil.example/")).toBe("/auth/login");
    expect(signInHref("https://evil.example/")).toBe("/auth/login");
  });

  it("recognises only the access-related API failures", () => {
    expect(isAccessIssueCode("invite_required")).toBe(true);
    expect(
      accessIssueFromFailure(
        new ApiError("Not provisioned", 403, {
          code: "account_not_provisioned",
        }),
      ),
    ).toMatchObject({ code: "account_not_provisioned", status: 403 });
    expect(
      accessIssueFromFailure(
        new ApiError("Full", 503, { code: "capacity_unavailable" }),
      ),
    ).toMatchObject({ code: "capacity_unavailable", status: 503 });
    expect(
      accessIssueFromFailure(new ApiError("Busy", 409, { code: "world_busy" })),
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
        new ApiError("Wrong status", 503, { code: "invite_required" }),
      ),
    ).toBeNull();
  });

  it("clears stale access issues after a successful session retry", async () => {
    const source = await readFile(new URL("./game-context.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/setSession\(nextSession\);\s+setError\(null\);\s+setAccessIssue\(null\);\s+setLoading\(false\);\s+enterBusy/s);
    expect(source).toMatch(/setBootstrap\(result\);\s+bootstrapRef\.current = result;\s+setError\(null\);\s+setAccessIssue\(null\);\s+setLoading\(false\);/s);
  });
});
