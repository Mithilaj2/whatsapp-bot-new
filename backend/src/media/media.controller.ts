import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { AuthUser, CurrentUser, Public } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import { media } from '../db/schema';

export const MIN_IMAGE_BYTES = 10 * 1024;
export const MAX_IMAGE_BYTES = Math.floor(4.9 * 1024 * 1024);

/** Recognises JPEG and PNG from the first bytes, whatever the file name says. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

/**
 * Campaign images. Uploaded files are public by link because WhatsApp downloads them when
 * sending; the names are random, so they can't be guessed.
 */
@Controller('media')
export class MediaController {
  private readonly dir: string;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    this.dir = resolve(config.get('UPLOAD_DIR', './uploads'));
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  publicUrl(fileName: string) {
    const api = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000/api').replace(/\/$/, '');
    return `${api}/media/${fileName}`;
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES + 1 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose an image to upload');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Image is too large: maximum 4.9 MB');
    if (file.size < MIN_IMAGE_BYTES) throw new BadRequestException('Image is too small: minimum 10 KB');
    const kind = sniff(file.buffer);
    if (!kind) throw new BadRequestException('Only JPEG or PNG images can be used');

    const id = randomUUID();
    const fileName = `${id}.${kind.ext}`;
    await writeFile(join(this.dir, fileName), file.buffer);
    await this.db.insert(media).values({
      id,
      accountId: user.accountId,
      fileName,
      originalName: file.originalname?.slice(0, 255),
      mimeType: kind.mime,
      size: file.size,
    });
    return { id, fileName, url: this.publicUrl(fileName), size: file.size, mimeType: kind.mime };
  }

  @Public()
  @Get(':fileName')
  async serve(@Param('fileName') fileName: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(fileName)) throw new NotFoundException();
    const [row] = await this.db.select().from(media).where(eq(media.fileName, fileName));
    const path = join(this.dir, fileName);
    if (!row || !existsSync(path)) throw new NotFoundException();
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(path).pipe(res);
  }
}
