import { Module } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { AlertEvaluationService } from './alert-evaluation.service';
import { AlertLifecycleService } from './alert-lifecycle.service';
import { AlertsController } from './alerts.controller';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';
import { AlertDeliveryRepository } from './delivery/alert-delivery.repository';
import { AlertDeliveryService } from './delivery/alert-delivery.service';
import { DeliveryTimer } from './delivery/delivery-timer';
import { emailDeliveryProviders } from './delivery/email-transport.provider';
import { AlertInputsQuery } from './queries/alert-inputs.query';

/**
 * Alerts, their lifecycle, evaluation, and email delivery (US5). It imports
 * no feature module and uses no forwardRef: the features that trigger
 * evaluation import this module, never the reverse (plan.md "Alert module
 * dependency direction"). Its only dependencies are the global PrismaService
 * and ConfigService, the shared finance helpers, and pure functions.
 */
@Module({
  controllers: [AlertsController],
  providers: [
    AlertsRepository,
    AlertsService,
    AlertLifecycleService,
    AlertInputsQuery,
    AlertEvaluationService,
    AlertDeliveryRepository,
    AlertDeliveryService,
    DeliveryTimer,
    Clock,
    ...emailDeliveryProviders,
  ],
  exports: [AlertsRepository, AlertsService, AlertEvaluationService],
})
export class AlertsModule {}
