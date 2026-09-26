import { createContext, useContext } from "react";

/** The club sheet a player was opened from, so the player sheet can offer a way back. */
export interface SheetOrigin {
  clubId: number;
  clubName: string;
}

export const SheetOriginContext = createContext<SheetOrigin | null>(null);

let pending: SheetOrigin | null = null;

/** Called by player links inside a club sheet right before the player sheet replaces it. */
export function rememberOrigin(origin: SheetOrigin | null) {
  pending = origin;
}

/** Read by the player sheet as it opens (safe to call twice under StrictMode). */
export const peekOrigin = () => pending;

/** Cleared once the player sheet has captured it, so later player opens start clean. */
export function clearOrigin() {
  pending = null;
}

export const useSheetOrigin = () => useContext(SheetOriginContext);
