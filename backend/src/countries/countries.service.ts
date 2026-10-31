import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, ilike, like, or, SQL } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { countries } from '../db/schema';
import type { ListCountriesQuery } from './countries.controller';

@Injectable()
export class CountriesService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(q: ListCountriesQuery) {
    const filters: (SQL | undefined)[] = [];
    if (q.status === 'active') filters.push(eq(countries.isActive, true));
    if (q.status === 'inactive') filters.push(eq(countries.isActive, false));
    if (q.search?.trim()) {
      const s = q.search.trim().replace(/^\+/, '');
      filters.push(
        or(
          ilike(countries.name, `%${s}%`),
          eq(countries.code, s.toUpperCase()),
          like(countries.isd, `${s}%`),
        ),
      );
    }
    const where = and(...filters);

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(countries)
        .where(where)
        .orderBy(asc(countries.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(countries).where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async setActive(id: string, isActive: boolean) {
    const [row] = await this.db
      .update(countries)
      .set({ isActive })
      .where(eq(countries.id, id))
      .returning();
    if (!row) throw new NotFoundException('Country not found');
    return row;
  }
}
