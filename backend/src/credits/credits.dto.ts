import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../common/pagination';
import { service, type Service } from '../db/schema';

export const MAX_CREDITS_PER_TRANSACTION = 10_000_000;

export class BalancesQuery extends PageQuery {
  @IsOptional()
  @IsIn(service.enumValues)
  service?: Service;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export type TxnCategory = 'platform' | 'transfers' | 'campaign';

export class TransactionsQuery extends PageQuery {
  @IsOptional()
  @IsIn(service.enumValues)
  service?: Service;

  @IsOptional()
  @IsIn(['platform', 'transfers', 'campaign'])
  category?: TxnCategory;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class CreateTransactionDto {
  /** The reseller or customer receiving (or giving back) credits. */
  @IsUUID()
  accountId: string;

  @IsIn(service.enumValues)
  service: Service;

  /** ISO country code, e.g. IN. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Length(2, 2)
  countryCode: string;

  /** GIVE adds credits to the account, TAKE removes them (back to you). */
  @IsIn(['GIVE', 'TAKE'])
  direction: 'GIVE' | 'TAKE';

  @Type(() => Number)
  @IsInt({ message: 'Credits must be a whole number' })
  @Min(1, { message: 'Enter at least 1 credit' })
  @Max(MAX_CREDITS_PER_TRANSACTION, { message: 'Maximum 1,00,00,000 credits per transaction' })
  amount: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remarks?: string;
}
