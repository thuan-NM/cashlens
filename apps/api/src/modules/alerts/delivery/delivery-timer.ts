import { Injectable } from '@nestjs/common';

/**
 * Elapsed time and waiting for the delivery loop, as a provider so unit
 * tests run retries and backoff instantly with a fake.
 */
@Injectable()
export class DeliveryTimer {
  /** Milliseconds from a monotonic-enough source, for budgets only. */
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
