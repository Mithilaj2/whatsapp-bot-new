import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../common/pagination';
import { parsePhone } from '../common/phone';
import { provider, service } from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digitsOnly = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[^\d]/g, '') : value;

export class CreateNumberDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label: string;

  @IsIn(provider.enumValues)
  provider: 'META' | 'TEST';

  @IsIn(service.enumValues)
  service: 'PREMIUM' | 'BRANDED';

  /** Leave empty for a shared platform number. */
  @IsOptional()
  @IsUUID()
  ownerAccountId?: string;

  @Transform(digitsOnly)
  @Matches(/^\d{8,15}$/, { message: 'Phone number must include the country code, e.g. 919845662183' })
  phoneNumber: string;

  @ValidateIf((o) => o.provider === 'META')
  @Transform(digitsOnly)
  @Matches(/^\d{5,30}$/, { message: 'Phone number ID is the long number shown in Meta (API Setup)' })
  phoneNumberId?: string;

  @ValidateIf((o) => o.provider === 'META')
  @Transform(digitsOnly)
  @Matches(/^\d{5,30}$/, { message: 'WhatsApp Business Account ID is the long number shown in Meta' })
  wabaId?: string;

  /** Optional per-number token. Without it the platform token from .env is used. */
  @IsOptional()
  @IsString()
  @MinLength(20)
  accessToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  ratePerSecond?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateNumberDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsString()
  @MinLength(20)
  accessToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  ratePerSecond?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class ButtonDto {
  @IsIn(['PHONE_NUMBER', 'URL', 'QUICK_REPLY'])
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY';

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(25, { message: 'Button text can be at most 25 characters' })
  text: string;

  @ValidateIf((o) => o.type === 'PHONE_NUMBER')
  // Numbers without a country code are read as Indian
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const p = parsePhone(value);
    return p ? `+${p.digits}` : value;
  })
  @Matches(/^\+\d{8,15}$/, { message: 'Call button needs a valid phone number' })
  phone?: string;

  @ValidateIf((o) => o.type === 'URL')
  @IsUrl({ require_protocol: true }, { message: 'Website button needs a full link starting with https://' })
  @MaxLength(2000)
  url?: string;
}

class HeaderDto {
  @IsIn(['IMAGE', 'TEXT'])
  type: 'IMAGE' | 'TEXT';

  @ValidateIf((o) => o.type === 'IMAGE')
  @IsUrl({ require_protocol: true, require_tld: false }, { message: 'Sample image must be a full link' })
  exampleUrl?: string;

  @ValidateIf((o) => o.type === 'TEXT')
  @IsString()
  @MaxLength(60)
  text?: string;
}

export class CreateTemplateDto {
  @IsUUID()
  senderNumberId: string;

  /** Meta allows lowercase letters, numbers and underscores. */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : value,
  )
  @Matches(/^[a-z0-9_]{1,512}$/, { message: 'Template name: lowercase letters, numbers and underscores' })
  name: string;

  @IsOptional()
  @Matches(/^[a-z]{2}(_[A-Z]{2})?$/, { message: 'Language like en, hi or en_US' })
  language?: string;

  @IsIn(['MARKETING', 'UTILITY'])
  category: 'MARKETING' | 'UTILITY';

  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderDto)
  header?: HeaderDto;

  @IsString()
  @MinLength(1)
  @MaxLength(1024, { message: 'Message can be at most 1,024 characters' })
  body: string;

  /** Sample values for {{1}}, {{2}}... Meta needs them to review the template. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bodyExamples?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ButtonDto)
  buttons?: ButtonDto[];
}

export class TemplatesQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  senderNumberId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'])
  status?: string;
}

export class TestSendDto {
  @IsString()
  @MinLength(8)
  to: string;

  /** An approved template, or leave empty and send `text` (only works inside the 24-hour reply window). */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bodyParams?: string[];

  @ValidateIf((o) => !o.templateId)
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text?: string;
}

export class SimulateInboundDto {
  @IsUUID()
  senderNumberId: string;

  @Transform(digitsOnly)
  @Matches(/^\d{8,15}$/)
  from: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class MessagesQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  senderNumberId?: string;

  @IsOptional()
  @IsIn(['OUT', 'IN'])
  direction?: 'OUT' | 'IN';

  @IsOptional()
  @IsIn(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'])
  status?: string;
}
