import { App, normalizePath } from "obsidian";
import * as path from "path";

/**
 * Resolves a valid Obsidian webview resource URI for an image file.
 * Modern Obsidian blocks arbitrary app://local URIs. This uses the vault adapter's
 * authorized getResourcePath API with fallback support.
 */
export function resolveImageResourceUri(app: App, absPath: string, relPath?: string): string {
  try {
    const adapter = app.vault.adapter as any;
    if (adapter && typeof adapter.getResourcePath === "function") {
      const vaultPath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";

      // Case 1: File is within vault directory
      if (vaultPath && absPath.startsWith(vaultPath)) {
        const relToVault = path.relative(vaultPath, absPath);
        const resourcePath = adapter.getResourcePath(normalizePath(relToVault));
        if (resourcePath) {
          return resourcePath.includes("?")
            ? `${resourcePath}&t=${Date.now()}`
            : `${resourcePath}?t=${Date.now()}`;
        }
      }

      // Case 2: Explicit relPath given relative to vault root
      if (relPath && !path.isAbsolute(relPath)) {
        const resourcePath = adapter.getResourcePath(normalizePath(relPath));
        if (resourcePath) {
          return resourcePath.includes("?")
            ? `${resourcePath}&t=${Date.now()}`
            : `${resourcePath}?t=${Date.now()}`;
        }
      }

      // Case 3: Absolute path outside vault (supported by desktop FileSystemAdapter)
      const absResourcePath = adapter.getResourcePath(absPath);
      if (absResourcePath) {
        return absResourcePath.includes("?")
          ? `${absResourcePath}&t=${Date.now()}`
          : `${absResourcePath}?t=${Date.now()}`;
      }
    }
  } catch (e) {
    console.warn("[DrawThings] resolveImageResourceUri failed:", e);
  }

  // Fallback
  return `app://local${absPath}?t=${Date.now()}`;
}
