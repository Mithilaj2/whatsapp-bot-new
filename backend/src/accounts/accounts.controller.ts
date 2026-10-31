import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, ListAccountsQuery, UpdateAccountDto } from './dto/account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @Roles('ADMIN', 'RESELLER')
  list(@CurrentUser() user: AuthUser, @Query() query: ListAccountsQuery) {
    return this.accounts.list(user, query);
  }

  @Get('tree')
  @Roles('ADMIN', 'RESELLER')
  tree(@CurrentUser() user: AuthUser) {
    return this.accounts.tree(user);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.accounts.stats(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.findOne(user, id);
  }

  @Post()
  @Roles('ADMIN', 'RESELLER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounts.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'RESELLER')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounts.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'RESELLER')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.remove(user, id);
  }
}
