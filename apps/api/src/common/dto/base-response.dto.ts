import { ApiProperty } from '@nestjs/swagger';

export class BaseResponseDto<T> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ required: false, nullable: true })
  data: T | null;

  @ApiProperty({ example: 'Success' })
  message: string;

  @ApiProperty({ example: '2026-06-11T00:00:00.000Z' })
  timestamp: string;

  /** Additive (ERR-006): the request's correlation id, also in `x-correlation-id`. */
  @ApiProperty({
    required: false,
    example: '3f0c1a9e-8b7d-4c2a-9e51-2b6f4d8a1c07',
  })
  correlationId?: string;

  constructor(data: T | null, message = 'Success', correlationId?: string) {
    this.success = true;
    this.data = data;
    this.message = message;
    this.timestamp = new Date().toISOString();
    if (correlationId) this.correlationId = correlationId;
  }
}
