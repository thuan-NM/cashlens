import { Prisma } from '@prisma/client';
import { ListAlertsDto } from '../dto/list-alerts.dto';

export const buildAlertWhere = (
  userId: string,
  query: ListAlertsDto,
): Prisma.AlertWhereInput => ({
  userId,
  severity: query.severity,
  isRead: query.read,
});
