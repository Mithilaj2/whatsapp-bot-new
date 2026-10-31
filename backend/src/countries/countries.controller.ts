import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Roles } from '../auth/decorators';
import { PageQuery } from '../common/pagination';
import { CountriesService } from './countries.service';

export class ListCountriesQuery extends PageQuery {
  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status: 'all' | 'active' | 'inactive' = 'all';
}

class UpdateCountryDto {
  @IsBoolean()
  isActive: boolean;
}

@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  list(@Query() query: ListCountriesQuery) {
    return this.countries.list(query);
  }

  /** Only the platform admin can switch countries on or off. */
  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCountryDto) {
    return this.countries.setActive(id, dto.isActive);
  }
}
