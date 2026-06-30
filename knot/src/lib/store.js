import fs from "fs";
import path from "path";
import { bootstrapMcpServers } from "@/lib/mcpBootstrap";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Reconcile env-declared MCP servers into the on-disk store. Idempotent and
// safe to call repeatedly — the bootstrap module guards itself with a
// module-level flag so this runs at most once per process.
try {
  bootstrapMcpServers();
} catch (err) {
  console.error("MCP bootstrap failed:", err);
}

export function readStore(name) {
  try {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading store ${name}:`, error);
    return [];
  }
}

export async function readStoreAsync(name) {
  try {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    const data = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function writeStore(name, data) {
  try {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`Error writing store ${name}:`, error);
    throw error;
  }
}
