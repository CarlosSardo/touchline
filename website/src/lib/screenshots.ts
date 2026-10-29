import manifest from "../../public/images/game/manifest.json";
import { url } from "./site";

export interface Screenshot {
  file: string;
  src: string;
  caption: string;
  alt: string;
  width: number;
  height: number;
  route: string;
}

export const screenshots: Screenshot[] = manifest.screenshots.map((s) => ({ ...s, src: url(`images/game/${s.file}`) }));

export const shot = (file: string): Screenshot => {
  const found = screenshots.find((s) => s.file === file);
  if (!found) throw new Error(`Unknown screenshot ${file}; see public/images/game/manifest.json`);
  return found;
};
