import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { PageQuery } from '../common/pagination';
import { OptOutsService } from './optouts.service';

class OptOutQuery extends PageQuery {
  @IsOptional()
  @IsIn(['PREMIUM', 'BRANDED'])
  service?: 'PREMIUM' | 'BRANDED';
}

class AddOptOutDto {
  @IsUUID()
  senderNumberId: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}

@Controller('opt-outs')
class OptOutsController {
  constructor(private readonly optOuts: OptOutsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: OptOutQuery) {
    return this.optOuts.list(user, q);
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Body() dto: AddOptOutDto) {
    return this.optOuts.add(user, dto.senderNumberId, dto.phone, dto.remarks);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.optOuts.remove(user, id);
  }
}

@Module({
  controllers: [OptOutsController],
  providers: [OptOutsService],
  exports: [OptOutsService],
})
export class OptOutsModule {}
