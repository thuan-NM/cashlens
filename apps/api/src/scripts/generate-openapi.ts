import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { createOpenApiDocument } from '../swagger';

async function generateOpenApi(): Promise<void> {
  process.env.JWT_SECRET ??= 'openapi-generation-only';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');

  const document = createOpenApiDocument(app);
  const outputDirectory = resolve(process.cwd(), 'docs');
  const outputPath = resolve(outputDirectory, 'swagger.json');

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, JSON.stringify(document, null, 2), 'utf8');
  await app.close();

  console.log(`OpenAPI document generated at ${outputPath}`);
}

generateOpenApi().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
