import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value;

/** Business categories WhatsApp shows on a profile. */
export const BRAND_CATEGORIES = [
  'Automotive',
  'Beauty, spa and salon',
  'Clothing and apparel',
  'Education',
  'Entertainment',
  'Event planning and service',
  'Finance and banking',
  'Food and grocery',
  'Public service',
  'Hotel and lodging',
  'Medical and health',
  'Non-profit',
  'Professional services',
  'Shopping and retail',
  'Travel and transportation',
  'Restaurant',
  'Other',
];

export class BrandDto {
  /** Whose brand this is. Defaults to my own account. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Enter the registered business name' })
  @MaxLength(150)
  organizationName: string;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Display name needs at least 3 characters' })
  @MaxLength(100)
  displayName: string;

  @IsIn(BRAND_CATEGORIES, { message: 'Pick a category' })
  category: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'Website must be a full link starting with https://' })
  @MaxLength(255)
  website?: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email' })
  @MaxLength(254)
  email: string;

  /** The number to put on WhatsApp. Must not be in use on the WhatsApp app. */
  @Transform(trim)
  @IsString()
  @MinLength(6, { message: 'Enter the WhatsApp number' })
  @MaxLength(30)
  phoneNumber: string;

  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Enter the business address' })
  @MaxLength(500)
  address: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxId?: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Enter a contact person' })
  @MaxLength(120)
  contactName: string;

  @IsOptional()
  @IsUUID()
  logoMediaId?: string;
}

export class ReviewBrandDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  /** Required to reject: tells the customer what to fix. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Required to approve: the Branded WhatsApp number set up for this customer. */
  @IsOptional()
  @IsUUID()
  senderNumberId?: string;
}

export class BrandsQuery extends PageQuery {
  @IsOptional()
  @IsIn(['SUBMITTED', 'APPROVED', 'REJECTED'])
  status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsUUID()
  accountId?: string;
}
