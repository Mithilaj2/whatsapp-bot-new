import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { sendCsv } from '../common/csv';
import { BalancesQuery, CreateTransactionDto, TransactionsQuery } from './credits.dto';
import { CreditsService } from './credits.service';

const serviceLabel = { PREMIUM: 'Premium Campaigns', BRANDED: 'Branded Campaigns' } as const;
const typeLabel = {
  CREDIT: 'Added',
  DEBIT: 'Removed',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  SPENT: 'Spent',
  REFUND: 'Refund',
} as const;

const stamp = () => new Date().toISOString().slice(0, 10);

@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.credits.summary(user);
  }

  @Get('balances')
  balances(@CurrentUser() user: AuthUser, @Query() q: BalancesQuery) {
    return this.credits.balances(user, q);
  }

  @Get('balances/export')
  async exportBalances(@CurrentUser() user: AuthUser, @Query() q: BalancesQuery, @Res() res: Response) {
    const rows = await this.credits.balancesForExport(user, q);
    sendCsv(
      res,
      `balances-${stamp()}.csv`,
      ['Account', 'Name', 'Service', 'Country', 'Balance', 'Last updated'],
      rows.map((r) => [r.username, r.accountName, serviceLabel[r.service], r.countryCode, r.balance, r.updatedAt]),
    );
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @Query() q: TransactionsQuery) {
    return this.credits.transactions(user, q);
  }

  @Get('transactions/export')
  async exportTransactions(
    @CurrentUser() user: AuthUser,
    @Query() q: TransactionsQuery,
    @Res() res: Response,
  ) {
    const rows = await this.credits.transactionsForExport(user, q);
    sendCsv(
      res,
      `transactions-${stamp()}.csv`,
      ['Date', 'Account', 'Service', 'Type', 'Credits', 'Balance after', 'Country', 'From/To', 'Campaign', 'Recipients', 'Remarks', 'By'],
      rows.map((r) => [
        r.createdAt,
        r.username,
        serviceLabel[r.service],
        typeLabel[r.type],
        r.amount,
        r.balanceAfter,
        r.countryCode,
        r.counterpartyUsername,
        r.campaignNo,
        r.recipients,
        r.remarks,
        r.createdBy,
      ]),
    );
  }

  @Post('transactions')
  @Roles('ADMIN', 'RESELLER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTransactionDto) {
    return this.credits.createTransaction(user, dto);
  }

  /** Checks every balance against the ledger. Should always return an empty list. */
  @Get('reconcile')
  @Roles('ADMIN')
  async reconcile() {
    const mismatches = await this.credits.reconcile();
    return { ok: mismatches.length === 0, mismatches };
  }
}
