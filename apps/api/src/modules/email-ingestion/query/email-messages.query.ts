import { Prisma } from '@prisma/client';
import { ListEmailMessagesDto } from '../dto/list-email-messages.dto';

export const buildEmailMessageWhere = (
  userId: string,
  query: ListEmailMessagesDto,
): Prisma.EmailMessageWhereInput => ({
  userId,
  emailConnectionId: query.emailConnectionId,
  processingStatus: query.processingStatus,
});
