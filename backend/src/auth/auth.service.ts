import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { users } from '../db/schema';
import { AuthUser } from './decorators';

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.username, username.trim().toLowerCase()),
      with: { account: true },
    });
    // Same message for wrong username or wrong password, so usernames can't be guessed
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !valid) throw new UnauthorizedException('Wrong username or password');
    if (!user.isActive || user.account.status !== 'ACTIVE' || user.account.deletedAt) {
      throw new UnauthorizedException('This account is not active. Contact your provider.');
    }

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const payload: AuthUser = {
      userId: user.id,
      accountId: user.accountId,
      accountType: user.account.type,
      username: user.username,
    };
    return { accessToken: await this.jwt.signAsync(payload), user: await this.me(payload) };
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
    await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(newPassword, 12) })
      .where(eq(users.id, user.id));
    return { ok: true };
  }
}
