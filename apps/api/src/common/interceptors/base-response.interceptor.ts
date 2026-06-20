import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { BaseResponseDto } from '../dto/base-response.dto';

@Injectable()
export class BaseResponseInterceptor<T>
  implements NestInterceptor<T, BaseResponseDto<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<BaseResponseDto<T>> {
    return next.handle().pipe(map((data) => new BaseResponseDto(data ?? null)));
  }
}
