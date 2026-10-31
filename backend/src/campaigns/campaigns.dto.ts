import { Transform } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value;

export const MESSAGE_MAX = 850;

export class CheckRecipientsDto {
  /** Who the campaign is for (and whose credits pay). Defaults to me. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsIn(['PREMIUM', 'BRANDED'])
  service: 'PREMIUM' | 'BRANDED';

  /** Branded Campaigns: which of the account's approved brands sends it. */
  @ValidateIf((o) => o.service === 'BRANDED')
  @IsUUID('all', { message: 'Pick a brand' })
  brandId?: string;

  /** Phone numbers, one per line (commas and semicolons also work). */
  @IsString()
  @MaxLength(3_000_000)
  numbers: string;
}

export class CreateCampaignDto extends CheckRecipientsDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Give the campaign a title' })
  @MaxLength(150)
  title: string;

  /** Uploaded image (POST /media). */
  @IsUUID('all', { message: 'Upload an image' })
  mediaId: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Write a message' })
  @MaxLength(MESSAGE_MAX, { message: `Message can be at most ${MESSAGE_MAX} characters` })
  message: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  callNumber?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'Website must be a full link starting with https://' })
  @MaxLength(500)
  visitUrl?: string;

  @Equals(true, { message: 'Tick the box to confirm you follow the sending rules' })
  consent: boolean;
}

export class CampaignDefaultsDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(MESSAGE_MAX)
  message?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  callNumber?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  visitUrl?: string;
}

export class CampaignsQuery extends PageQuery {
  @IsOptional()
  @IsIn(['PREMIUM', 'BRANDED'])
  service?: 'PREMIUM' | 'BRANDED';

  @IsOptional()
  @IsIn(['PENDING_APPROVAL', 'SENDING', 'COMPLETED', 'CANCELLED', 'REJECTED'])
  status?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class RecipientsQuery extends PageQuery {
  @IsOptional()
  @IsIn(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED'])
  status?: string;
}

export class LimitsQuery {
  @IsOptional()
  @IsIn(['PREMIUM', 'BRANDED'])
  service?: 'PREMIUM' | 'BRANDED';
}
