// Storage for the manager portal.
//
// Production uses Netlify Blobs (private, server-side only, nothing about it
// is reachable from the browser). Records live in a handful of collection
// documents rather than one key per record: a personal CRM holds hundreds of
// records, not millions, and one read per collection keeps every page fast.
// Writes use the document's ETag (optimistic concurrency), so a website
// inquiry arriving while a record is being edited can never overwrite it.
//
// SD_STORE_DRIVER=file switches to a local folder for development and the
// automated tests. It is never set on Netlify, and the Blobs driver fails
// loudly rather than silently falling back to disk.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const STORE_NAME = "sd-portal";

function fileDriver() {
  const root = path.resolve(process.env.SD_STORE_DIR || ".portal-data");
  const fileFor = (key) => path.join(root, ...key.split("/").map(encodeURIComponent)) + ".json";
  const etagOf = (text) => createHash("sha1").update(text).digest("hex");

  return {
    async get(key) {
      try {
        const text = await fs.readFile(fileFor(key), "utf8");
        return { value: JSON.parse(text), etag: etagOf(text) };
      } catch (e) {
        if (e.code === "ENOENT") return { value: null, etag: null };
        throw e;
      }
    },
    async set(key, value, { ifMatch, ifNew } = {}) {
      const file = fileFor(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (ifMatch || ifNew) {
        const current = await this.get(key);
        if (ifNew && current.etag) return { modified: false };
        if (ifMatch && current.etag !== ifMatch) return { modified: false };
      }
      const text = JSON.stringify(value);
      await fs.writeFile(file, text);
      return { modified: true, etag: etagOf(text) };
    },
    async delete(key) {
      await fs.rm(fileFor(key), { force: true });
    },
    async list(prefix) {
      const dir = path.join(root, ...prefix.replace(/\/$/, "").split("/").map(encodeURIComponent));
      try {
        const names = await fs.readdir(dir);
        return names.filter((n) => n.endsWith(".json")).map((n) => `${prefix.replace(/\/$/, "")}/${decodeURIComponent(n.slice(0, -5))}`);
      } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
      }
    },
  };
}

async function blobsDriver() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  return {
    async get(key) {
      const res = await store.getWithMetadata(key, { type: "json" });
      if (!res) return { value: null, etag: null };
      return { value: res.data, etag: res.etag };
    },
    async set(key, value, { ifMatch, ifNew } = {}) {
      const opts = {};
      if (ifMatch) opts.onlyIfMatch = ifMatch;
      if (ifNew) opts.onlyIfNew = true;
      const res = await store.setJSON(key, value, opts);
      return { modified: res?.modified !== false, etag: res?.etag };
    },
    async delete(key) {
      await store.delete(key);
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

let driverPromise;
export function store() {
  if (!driverPromise) {
    driverPromise = process.env.SD_STORE_DRIVER === "file" ? Promise.resolve(fileDriver()) : blobsDriver();
  }
  return driverPromise;
}

/**
 * Read-modify-write with optimistic concurrency. `fn` receives the current
 * value (or `fallback` when the key is new) and returns the next value, or
 * `undefined` to leave it unchanged. Retries a few times on a conflicting
 * write, then gives up loudly instead of losing data.
 */
export async function update(key, fallback, fn) {
  const s = await store();
  for (let attempt = 0; attempt < 6; attempt++) {
    const { value, etag } = await s.get(key);
    const current = value ?? structuredClone(fallback);
    const next = await fn(current);
    if (next === undefined) return current;
    const res = await s.set(key, next, etag ? { ifMatch: etag } : { ifNew: true });
    if (res.modified) return next;
    await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
  }
  throw new Error(`Could not save ${key}: it kept changing underneath this write.`);
}

export async function read(key, fallback = null) {
  const s = await store();
  const { value } = await s.get(key);
  return value ?? fallback;
}

export async function write(key, value) {
  const s = await store();
  return s.set(key, value);
}

export async function remove(key) {
  const s = await store();
  return s.delete(key);
}

export async function listKeys(prefix) {
  const s = await store();
  return s.list(prefix);
}
