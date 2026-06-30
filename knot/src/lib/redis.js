import Redis from "ioredis";

let _client = null;

export function getRedis() {
  if (!_client) {
    _client = new Redis(process.env.REDIS_URL || "redis://localhost:6379/0", {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    _client.on("error", (e) => {
      if (e.code !== "ECONNREFUSED") console.warn("[redis]", e.message);
    });
  }
  return _client;
}
