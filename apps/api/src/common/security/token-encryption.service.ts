import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

@Injectable()
export class TokenEncryptionService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string): string {
    const [version, iv, authTag, encrypted] = value.split('.');
    if (version !== 'v1' || !iv || !authTag || !encrypted) {
      throw new Error('Invalid encrypted token payload');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    const secret = this.configService.get<string>(
      'EMAIL_TOKEN_ENCRYPTION_KEY',
    );
    if (!secret || secret.length < 32) {
      throw new Error(
        'EMAIL_TOKEN_ENCRYPTION_KEY must contain at least 32 characters',
      );
    }

    return createHash('sha256').update(secret).digest();
  }
}
