import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BankProvidersRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listActive() {
    return this.prisma.bankProvider.findMany({
      where: { status: { in: ['ACTIVE', 'EXPERIMENTAL'] } },
      include: {
        emailSenders: { where: { status: 'ACTIVE' } },
      },
      orderBy: { name: 'asc' },
    });
  }
}
