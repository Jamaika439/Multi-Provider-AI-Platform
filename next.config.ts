/**
 * next.config.ts
 * =============================================================================
 * Konfiguration von Next.js.
 * =============================================================================
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sql.js liest seine WASM-Datei zur Laufzeit von der Festplatte (siehe
  // lib/db.ts). Es soll deshalb nicht in das Server-Bundle eingebaut werden,
  // sondern normal aus node_modules geladen werden.
  serverExternalPackages: ["sql.js"],
};

export default nextConfig;
