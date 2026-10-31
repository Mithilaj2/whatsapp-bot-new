import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export const DB = Symbol('DB');
const POOL = Symbol('PG_POOL');

/** Inject the database with: constructor(@InjectDb() private readonly db: Db) */
export const InjectDb = () => Inject(DB);

@Injectable()
class PoolCloser implements OnModuleDestroy {
  constructor(@Inject(POOL) private readonly pool: Pool) {}
  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        if (!url) throw new Error('Set DATABASE_URL in .env');
        return new Pool({ connectionString: url, max: 10 });
      },
    },
    {
      provide: DB,
      inject: [POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    PoolCloser,
  ],
  exports: [DB],
})
export class DbModule {}
