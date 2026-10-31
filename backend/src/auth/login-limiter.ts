import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Bucket {
  fails: number;
  until: number;
}

/**
 * Slows down password guessing: after too many wrong passwords for one username, or from one
 * address, logins are refused for a while. Kept in memory (one API server).
 */
@Injectable()
export class LoginLimiter {
  private readonly users = new Map<string, Bucket>();
  private readonly ips = new Map<string, Bucket>();
  readonly windowMs = 15 * 60_000;
  readonly maxPerUser = Number(process.env.LOGIN_MAX_FAILS_USER || 8);
  readonly maxPerIp = Number(process.env.LOGIN_MAX_FAILS_IP || 30);

  private hit(map: Map<string, Bucket>, key: string) {
    const now = Date.now();
    const b = map.get(key);
    if (!b || b.until < now) map.set(key, { fails: 1, until: now + this.windowMs });
    else b.fails++;
    if (map.size > 50_000) for (const [k, v] of map) if (v.until < now) map.delete(k);
  }

  private blocked(map: Map<string, Bucket>, key: string, max: number) {
    const b = map.get(key);
    return b && b.until > Date.now() && b.fails >= max ? Math.ceil((b.until - Date.now()) / 60_000) : 0;
  }

  /** Throws 429 when this username or address has failed too often. */
  check(username: string, ip: string) {
    const mins = Math.max(this.blocked(this.users, username, this.maxPerUser), this.blocked(this.ips, ip, this.maxPerIp));
    if (mins) {
      throw new HttpException(`Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  failed(username: string, ip: string) {
    this.hit(this.users, username);
    this.hit(this.ips, ip);
  }

  succeeded(username: string) {
    this.users.delete(username);
  }
}
