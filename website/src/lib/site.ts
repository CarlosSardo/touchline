import { REPO_BRANCH, REPO_URL, withBase } from "./routes.mjs";

export const SITE_TITLE = "Touchline";
export const SITE_TAGLINE = "The football sporting-director simulation";
export const SITE_DESCRIPTION =
  "Touchline is a football sporting-director simulation: build a club's long-term project through recruitment, contracts, the academy, staff, facilities and finances in a living procedural football world.";
export { REPO_BRANCH, REPO_URL };

export const url = (path = "") => withBase(import.meta.env.BASE_URL, path);
