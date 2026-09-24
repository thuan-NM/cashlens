import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { App } from 'supertest/types';
import { TokenEncryptionService } from '../../src/common/security/token-encryption.service';
import type { GmailMessage } from '../../src/modules/email-ingestion/gmail-api.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { Agent, dataOf, syntheticEmail } from './auth-fixtures';

/**
 * Synthetic Gmail fixtures for e2e suites. Gmail never runs in tests: suites
 * spy on GmailApiService/GmailOAuthService and answer with these shapes.
 * Tokens are random per call and stored encrypted exactly as the app stores
 * them; only reserved test domains appear.
 */

export const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';

export type GmailConnectionFixture = {
  id: string;
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
};

export async function createGmailConnection(
  app: INestApplication<App>,
  userId: string,
  label: string,
): Promise<GmailConnectionFixture> {
  const prisma = app.get(PrismaService);
  const encryption = app.get(TokenEncryptionService);
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const emailAddress = syntheticEmail(`${label}-inbox`);
  const row = await prisma.emailConnection.create({
    data: {
      userId,
      provider: 'GMAIL',
      emailAddress,
      providerUserId: emailAddress,
      accessTokenEncrypted: encryption.encrypt(accessToken),
      refreshTokenEncrypted: encryption.encrypt(refreshToken),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: [GMAIL_READONLY],
      status: 'ACTIVE',
    },
  });
  return { id: row.id, emailAddress, accessToken, refreshToken };
}

/** A Gmail API `messages.get` (format=full) answer with a text/plain body. */
export function gmailMessage(input: {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: Date;
}): GmailMessage {
  return {
    id: input.id,
    threadId: `thread-${input.id}`,
    internalDate: String(input.receivedAt.getTime()),
    snippet: input.body.slice(0, 120),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: input.from },
        { name: 'Subject', value: input.subject },
        { name: 'Message-ID', value: `<${input.id}@mail.example.test>` },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from(input.body).toString('base64url') },
        },
      ],
    },
  };
}

/** Creates a global parser template as an administrator; returns its id. */
export async function createParserTemplate(
  admin: Agent,
  definition: Record<string, unknown>,
): Promise<string> {
  const response = await admin
    .post('/api/parser-templates')
    .send(definition)
    .expect(201);
  return dataOf<{ id: string }>(response).id;
}

/** Owner-scoped listen rule for one sender on one connection. */
export async function createListenRule(
  owner: Agent,
  input: { connectionId: string; senderEmail: string; bankProviderId: string },
): Promise<string> {
  const response = await owner
    .post('/api/email-listen-rules')
    .send({
      name: `Rule ${randomBytes(3).toString('hex')}`,
      emailConnectionId: input.connectionId,
      bankProviderId: input.bankProviderId,
      senderEmail: input.senderEmail,
      isEnabled: true,
      priority: 10,
    })
    .expect(201);
  return dataOf<{ id: string }>(response).id;
}
