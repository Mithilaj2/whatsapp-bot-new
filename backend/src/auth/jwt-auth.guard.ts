import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { accounts, users } from '../db/schema';
import { AuthUser, IS_PUBLIC_KEY } from './decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectDb() private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Please log in');

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Session expired, please log in again');
    }

    // Block users or accounts that were suspended or deleted after the token was issued
    const [row] = await this.db
      .select({ isActive: users.isActive, tokenVersion: users.tokenVersion, status: accounts.status, deletedAt: accounts.deletedAt })
      .from(users)
      .innerJoin(accounts, eq(accounts.id, users.accountId))
      .where(eq(users.id, payload.userId))
      .limit(1);
    if (!row || !row.isActive || row.status !== 'ACTIVE' || row.deletedAt) {
      throw new UnauthorizedException('This account is not active');
    }
    // The password changed since this login
    if ((payload.tv ?? 0) !== row.tokenVersion) throw new UnauthorizedException('Session expired, please log in again');

    request.user = {
      userId: payload.userId,
      accountId: payload.accountId,
      accountType: payload.accountType,
      username: payload.username,
    } satisfies AuthUser;
    return true;
  }
}
