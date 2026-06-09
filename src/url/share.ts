import { decodePuzzle, encodePuzzle } from "../game/serialize";
import { parseDateKey } from "../game/daily";
import type { Puzzle } from "../game/types";

const PARAM = "p";

function normalizeHash(value: string): string {
  const withoutHash = value.replace(/^#/, "").trim();
  return withoutHash;
}

function extractCode(value: string): string | null {
  const normalized = normalizeHash(value);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith(`${PARAM}=`)) {
    return normalized.slice(PARAM.length + 1);
  }

  return normalized;
}

function extractCodeFromPath(pathname: string): string | null {
  const normalized = pathname.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized;
}

export function puzzleToShareUrl(puzzle: Puzzle, pathname = "/"): string {
  const url = new URL(window.location.href);
  const code = encodePuzzle(puzzle);
  const basePath = pathname.trim().replace(/\/+$/g, "");
  url.pathname = `${basePath}/${code}`.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function dailyDateKeyToShareUrl(
  dateKey: string,
  pathname = "/",
): string {
  const url = new URL(window.location.href);
  url.pathname = pathname;
  url.search = "";
  url.hash = dateKey;
  return url.toString();
}

export function puzzleToCode(puzzle: Puzzle): string {
  return encodePuzzle(puzzle);
}

export function puzzleFromCurrentUrl(): Puzzle | null {
  const pathCode = extractCodeFromPath(window.location.pathname);
  if (pathCode && pathCode !== "build") {
    const fromPath = decodePuzzle(pathCode);
    if (fromPath) {
      return fromPath;
    }
  }

  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith(`${PARAM}=`)) {
    return null;
  }
  const encoded = hash.slice(PARAM.length + 1);
  return decodePuzzle(encoded);
}

export function puzzleFromText(value: string): Puzzle | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const hashCode = extractCode(url.hash);
      if (hashCode) {
        const fromHash = decodePuzzle(hashCode);
        if (fromHash) {
          return fromHash;
        }
      }

      const pathCode = extractCodeFromPath(url.pathname);
      if (!pathCode || pathCode === "build") {
        return null;
      }

      return decodePuzzle(pathCode);
    }
  } catch {
    return null;
  }

  const directCode = extractCode(trimmed);
  if (!directCode) {
    return null;
  }

  return decodePuzzle(directCode);
}

export function dailyDateKeyFromText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const hash = normalizeHash(url.hash);
      if (!hash || hash.startsWith(`${PARAM}=`)) {
        return null;
      }
      return parseDateKey(hash) ? hash : null;
    }
  } catch {
    return null;
  }

  const directHash = normalizeHash(trimmed);
  if (!directHash || directHash.startsWith(`${PARAM}=`)) {
    return null;
  }

  return parseDateKey(directHash) ? directHash : null;
}

export function setCurrentUrlPuzzle(puzzle: Puzzle): void {
  const code = encodePuzzle(puzzle);
  const nextPath = `/${code}`;
  if (window.location.pathname === nextPath) {
    return;
  }

  window.history.replaceState(null, "", nextPath);
}
