import { BadGatewayException, Injectable } from '@nestjs/common';

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

@Injectable()
export class GmailApiService {
  async listMessageIds(accessToken: string, query: string) {
    const params = new URLSearchParams({ maxResults: '100' });
    if (query) params.set('q', query);
    const response = await this.request<{
      messages?: Array<{ id: string }>;
    }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      accessToken,
    );
    return response.messages?.map((message) => message.id) ?? [];
  }

  getMessage(accessToken: string, id: string) {
    return this.request<GmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      accessToken,
    );
  }

  header(message: GmailMessage, name: string) {
    return message.payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value;
  }

  body(message: GmailMessage) {
    const values: string[] = [];
    const visit = (part?: GmailPart) => {
      if (!part) return;
      if (
        part.body?.data &&
        (part.mimeType === 'text/plain' || part.mimeType === 'text/html')
      ) {
        values.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
      }
      part.parts?.forEach(visit);
    };
    visit(message.payload);
    return values.join('\n');
  }

  private async request<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new BadGatewayException('Gmail API request failed');
    return response.json() as Promise<T>;
  }
}
