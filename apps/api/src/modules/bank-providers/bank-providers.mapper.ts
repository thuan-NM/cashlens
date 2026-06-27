import { BankProvider, BankEmailSender } from '@prisma/client';

export const toBankProviderResponse = (
  provider: BankProvider & { emailSenders: BankEmailSender[] },
) => ({
  id: provider.id,
  code: provider.code,
  name: provider.name,
  countryCode: provider.countryCode,
  website: provider.website,
  logoUrl: provider.logoUrl,
  status: provider.status,
  supportedChannels: provider.supportedChannels,
  emailSenders: provider.emailSenders.map((sender) => ({
    id: sender.id,
    senderEmail: sender.senderEmail,
    senderDomain: sender.senderDomain,
    senderName: sender.senderName,
    isVerified: sender.isVerified,
    status: sender.status,
  })),
});
