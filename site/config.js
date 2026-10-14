// URL of the deployed Cloudflare Worker that renders PNGs.
// The deploy workflow overwrites this file from the WORKER_URL repo variable.
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
export const WORKER_URL = local ? "http://localhost:8787" : "https://hijri-life-calendar.YOUR-SUBDOMAIN.workers.dev";
