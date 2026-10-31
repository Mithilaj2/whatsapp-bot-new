import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { BRAND_CATEGORIES, BrandDto, BrandsQuery, ReviewBrandDto } from './brands.dto';
import { BrandsService } from './brands.service';

class ApprovedQuery {
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

/** Onboarding form for Branded Campaigns: a customer's own WhatsApp brand and number. */
@Controller('brands')
class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get('categories')
  categories() {
    return BRAND_CATEGORIES;
  }

  @Get('approved')
  approved(@CurrentUser() user: AuthUser, @Query() q: ApprovedQuery) {
    return this.brands.approved(user, q.accountId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: BrandsQuery) {
    return this.brands.list(user, q);
  }

  @Post()
  submit(@CurrentUser() user: AuthUser, @Body() dto: BrandDto) {
    return this.brands.submit(user, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.brands.detail(user, id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BrandDto) {
    return this.brands.update(user, id, dto);
  }

  @Post(':id/review')
  @Roles('ADMIN')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewBrandDto) {
    return this.brands.review(user, id, dto);
  }
}

@Module({
  controllers: [BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
