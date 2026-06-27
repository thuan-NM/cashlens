import { Module } from '@nestjs/common';
import { ParserController } from './parser.controller';
import { ParserEngineService } from './parser-engine.service';
import { ParserRepository } from './parser.repository';
import { ParserService } from './parser.service';

@Module({
  controllers: [ParserController],
  providers: [ParserEngineService, ParserRepository, ParserService],
  exports: [ParserService],
})
export class ParserModule {}
