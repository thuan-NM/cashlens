import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from '../config/configuration';
import { AdminBootstrapService } from '../modules/users/admin-bootstrap.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Minimal context for the operator bootstrap (SEC-009): validated
 * configuration and Prisma only, so an invalid configuration fails closed.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
  ],
  providers: [AdminBootstrapService],
})
export class BootstrapAdminModule {}
