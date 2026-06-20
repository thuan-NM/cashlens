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

  constructor(data: T | null, message = 'Success') {
    this.success = true;
    this.data = data;
    this.message = message;
    this.timestamp = new Date().toISOString();
  }
}
