import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import { Public } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import { accounts } from '../db/schema';

/**
 * White-label branding for the login page. A reseller's customers open the panel
 * on the reseller's own domain and see the reseller's name and logo.
 */
@Controller('public/branding')
export class BrandingController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  /**
   * Caddy asks this before getting an SSL certificate for a domain (on-demand TLS), so
   * certificates are only issued for our own domains and resellers' white-label domains.
   */
  @Public()
  @Get('tls-check')
  async tlsCheck(@Query('domain') raw?: string) {
    const domain = (raw || '').toLowerCase().trim();
    const own = (this.config.get<string>('PANEL_DOMAINS', '') || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (domain && own.includes(domain)) return 'ok';
    if (!/^[a-z0-9.-]{3,253}$/.test(domain)) throw new NotFoundException();
    const [row] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.domain, domain), isNull(accounts.deletedAt), eq(accounts.status, 'ACTIVE')))
      .limit(1);
    if (!row) throw new NotFoundException();
    return 'ok';
  }

  @Public()
  @Get()
  async byHost(@Query('host') host?: string) {
    const domain = (host || '').toLowerCase().split(':')[0];
    const columns = { brandName: accounts.brandName, name: accounts.name, logoUrl: accounts.logoUrl };

    const [reseller] = domain
      ? await this.db
          .select(columns)
          .from(accounts)
          .where(
            and(eq(accounts.domain, domain), isNull(accounts.deletedAt), eq(accounts.status, 'ACTIVE')),
          )
          .limit(1)
      : [];
    const [admin] = reseller
      ? [reseller]
      : await this.db.select(columns).from(accounts).where(eq(accounts.type, 'ADMIN')).limit(1);

    return {
      brandName: admin?.brandName || admin?.name || 'We Brand 360',
      logoUrl: admin?.logoUrl ?? null,
    };
  }
}
