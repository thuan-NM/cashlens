import { Injectable } from '@nestjs/common';

/**
 * The current instant as a provider, so tests can fix it. Results that depend
 * on the current user month (goal feasibility, T058/T063) read time here.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
