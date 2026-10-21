// Small UI text helpers (British English, en-GB number formatting).

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd, 101st. */
export function ordinal(value: number) {
  const tens = Math.abs(value) % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  switch (Math.abs(value) % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/** "1 year", "3 years", "1,200 players". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? singular : pluralForm}`;
}

/** "2026/27", optionally with a pre-season suffix in July. */
export function seasonText(season: number, preSeason = false) {
  return `${season}/${String(season + 1).slice(-2)}${preSeason ? " pre-season" : ""}`;
}

/** Board target: "Win the league" instead of "Finish in the top 1". */
export function expectationText(places: number) {
  return places <= 1 ? "Win the league" : `Finish in the top ${places}`;
}

/** Unread counter for navigation badges ("99+" when the feed page was full). */
export function unreadLabel(count: number, pageLimit: number) {
  return count >= pageLimit ? `${pageLimit - 1}+` : String(count);
}
