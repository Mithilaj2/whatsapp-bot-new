import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AccountType } from '../db/schema';

export const IS_PUBLIC_KEY = 'isPublic';
/** Route can be called without logging in. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Route is only allowed for these account types. */
export const Roles = (...types: AccountType[]) => SetMetadata(ROLES_KEY, types);

/** The logged-in user, as stored in the login token. */
export interface AuthUser {
  /** Token version (see users.tokenVersion). */
  tv?: number;
  userId: string;
  accountId: string;
  accountType: AccountType;
  username: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
