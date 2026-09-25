import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { buildPinoHttpOptions } from './logging.config';

@Module({
  imports: [PinoLoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions() })],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
