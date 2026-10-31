import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.module';
import { Db, InjectDb } from '../db/db.module';
import { users } from '../db/schema';
import { AuthUser } from './decorators';
import { LoginLimiter } from './login-limiter';

/** Compared against when the username doesn't exist, so both cases take the same time. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly limiter: LoginLimiter,
    private readonly audit: AuditService,
  ) {}

  private token(u: { id: string; accountId: string; username: string; tokenVersion: number }, accountType: AuthUser['accountType']) {
    const payload: AuthUser = { userId: u.id, accountId: u.accountId, accountType, username: u.username, tv: u.tokenVersion };
    return { payload, accessToken: this.jwt.signAsync(payload) };
  }

  async login(rawUsername: string, password: string, ip = '') {
    const username = rawUsername.trim().toLowerCase().slice(0, 60);
    this.limiter.check(username, ip);
    const user = await this.db.query.users.findFirst({
      where: eq(users.username, username),
      with: { account: true },
    });
    // Same message and same time for a wrong username or a wrong password, so usernames can't be guessed
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      this.limiter.failed(username, ip);
      void this.audit.record({ accountId: user?.accountId, username, action: 'LOGIN_FAILED', ip });
      throw new UnauthorizedException('Wrong username or password');
    }
    if (!user.isActive || user.account.status !== 'ACTIVE' || user.account.deletedAt) {
      throw new UnauthorizedException('This account is not active. Contact your provider.');
    }
    this.limiter.succeeded(username);

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const t = this.token(user, user.account.type);
    void this.audit.record({ actor: t.payload, action: 'LOGIN', ip });
    return { accessToken: await t.accessToken, user: await this.me(t.payload) };
  }

  async me(auth: AuthUser) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, auth.userId),
      with: {
        account: { with: { parent: { columns: { username: true, name: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException();
    const a = user.account;
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      account: {
        id: a.id,
        username: a.username,
        name: a.name,
        type: a.type,
        brandName: a.brandName,
        logoUrl: a.logoUrl,
        parent: a.parent,
      },
    };
  }

  async changePassword(auth: AuthUser, currentPassword: string, newPassword: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, auth.userId) });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is wrong');
    }
    // Signs out every other device; this one gets a fresh token
    const [u] = await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(newPassword, 12), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning();
    return { ok: true, accessToken: await this.token(u, auth.accountType).accessToken };
  }
}
