import { accountStatus, type AccountType } from '../../db/schema';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQuery } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : trim({ value });

/** Turns "https://Panel.Example.com/login" into "panel.example.com". */
export const normalizeDomain = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return cleaned === '' ? null : cleaned;
};

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export class ListAccountsQuery extends PageQuery {
  @IsOptional()
  @IsIn(['RESELLER', 'CUSTOMER'])
  type?: 'RESELLER' | 'CUSTOMER';
}

export class CreateAccountDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^[a-z0-9._-]{3,30}$/, {
    message: 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore',
  })
  username: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsIn(['RESELLER', 'CUSTOMER'])
  type: 'RESELLER' | 'CUSTOMER';

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  /** Defaults to the logged-in account. Can be any reseller below it. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail()
  email?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @Transform(normalizeDomain)
  @IsOptional()
  @Matches(DOMAIN_RE, { message: 'Enter a valid domain, e.g. panel.example.com' })
  domain?: string | null;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brandName?: string;
}

export class UpdateAccountDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(accountStatus.enumValues)
  status?: 'ACTIVE' | 'SUSPENDED';

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @Transform(normalizeDomain)
  @IsOptional()
  @Matches(DOMAIN_RE, { message: 'Enter a valid domain, e.g. panel.example.com' })
  domain?: string | null;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brandName?: string | null;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'Logo must be a full https:// link' })
  logoUrl?: string | null;

  /** Resets the password of the account's owner login. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;
}

export type ChildType = Extract<AccountType, 'RESELLER' | 'CUSTOMER'>;
