import hashlib
import math
import threading
import time

from app.core.errors import AppError


def exceeded(retry):
    return AppError(429, 'rate_limit', 'Too many requests', headers={'Retry-After': str(max(1, math.ceil(retry)))})


class MemoryRateLimiter:
    """Thread-safe test implementation. Never used by deployed application workers."""
    def __init__(self):
        self.entries = {}
        self.lock = threading.Lock()

    def hit(self, key, limit, window_seconds):
        with self.lock:
            now = time.monotonic()
            count, end = self.entries.get(key, (0, now + window_seconds))
            if end <= now:
                count, end = 0, now + window_seconds
            if count >= limit:
                raise exceeded(end - now)
            self.entries[key] = count + 1, end
            return limit - count - 1

    def close(self):
        pass


class RedisRateLimiter:
    SCRIPT = """
    local n = redis.call('INCR', KEYS[1])
    if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    return {n, redis.call('TTL', KEYS[1])}
    """

    def __init__(self, url):
        import redis
        self.redis = redis.Redis.from_url(url, socket_connect_timeout=3, socket_timeout=3)
        self.script = self.redis.register_script(self.SCRIPT)

    def hit(self, key, limit, window_seconds):
        import redis
        # Email/IP identifiers are never stored as plaintext in Redis keys.
        key = 'lifehub:rate:' + hashlib.sha256(key.encode()).hexdigest()
        try:
            count, ttl = self.script(keys=[key], args=[window_seconds])
        except redis.RedisError as exc:
            raise AppError(503, 'rate_limiter_unavailable', 'Please try again later') from exc
        if count > limit:
            raise exceeded(ttl)
        return limit - count

    def close(self):
        self.redis.close()
