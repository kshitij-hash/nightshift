#!/usr/bin/env node
// Zero-dependency static server for the ops console.
//   node scripts/serve.mjs   →  http://localhost:8734
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/web/index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root)) || file.includes(".env") || file.includes(".git")) {
      res.writeHead(403); return res.end("no");
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(8734, "127.0.0.1", () => console.log("ops console: http://localhost:8734"));
