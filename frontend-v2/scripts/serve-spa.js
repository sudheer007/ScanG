#!/usr/bin/env node
/**
 * Zero-dependency static file server with SPA fallback.
 * Deep links like /stock/TSLA serve index.html so expo-router can handle them.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const isAsset = filePath.includes(`${path.sep}_expo`) || filePath.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": isAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendIndex(res) {
  const indexPath = path.join(ROOT, "index.html");
  if (!fs.existsSync(indexPath)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Missing dist/index.html — run yarn build:web first.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
  });
  fs.createReadStream(indexPath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  } catch {
    pathname = "/";
  }

  const filePath = safeJoin(ROOT, pathname === "/" ? "/index.html" : pathname);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, filePath);
      return;
    }

    const asIndex = path.join(filePath, "index.html");
    fs.stat(asIndex, (dirErr, dirStat) => {
      if (!dirErr && dirStat.isFile()) {
        sendFile(res, asIndex);
        return;
      }
      // SPA fallback for client routes (/stock/TSLA, /analyzer/AAPL, etc.)
      sendIndex(res);
    });
  });
});

if (!fs.existsSync(ROOT)) {
  console.error(`Publish directory not found: ${ROOT}`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`ScanG web listening on ${PORT} (SPA fallback → index.html)`);
});
