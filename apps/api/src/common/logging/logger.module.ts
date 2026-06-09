import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
        transport: isProduction
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'SYS:standard',
              },
            },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.cookies',
            'res.headers.set-cookie',
            'body.password',
            'body.passwordHash',
            'body.token',
            'body.accessToken',
            'body.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        customProps: (req) => ({
          requestId: req.id,
        }),
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
