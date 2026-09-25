import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { Observable, map } from 'rxjs';
import { BaseResponseDto } from '../dto/base-response.dto';
import { correlationIdOf } from '../http/correlation';

/**
 * Wraps every success in `{success, data, message, timestamp}` plus the
 * additive `correlationId` (plan.md "API Compatibility", ERR-006).
 */
@Injectable()
export class BaseResponseInterceptor<T> implements NestInterceptor<
  T,
  BaseResponseDto<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<BaseResponseDto<T>> {
    const correlationId =
      context.getType() === 'http'
        ? correlationIdOf(context.switchToHttp().getRequest<IncomingMessage>())
        : undefined;
    return next
      .handle()
      .pipe(
        map(
          (data) => new BaseResponseDto(data ?? null, 'Success', correlationId),
        ),
      );
  }
}
