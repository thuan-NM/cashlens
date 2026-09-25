import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { createOpenApiDocument } from '../swagger';

async function generateOpenApi(): Promise<void> {
  // Configuration is validated when AppModule is imported, so this offline-only
  // value must be set before the module is loaded.
  process.env.JWT_SECRET ??= 'openapi-generation-only';
  const { AppModule } = await import('../app.module.js');

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

  const generated = JSON.stringify(document, null, 2);
  await app.close();

  // --check: fail when the committed document differs from the code (line
  // endings ignored), so a DTO or decorator change cannot ship without it.
  if (process.argv.includes('--check')) {
    const committed = await readFile(outputPath, 'utf8').catch(() => '');
    if (committed.replace(/\r\n/g, '\n') !== generated) {
      console.error(
        `${outputPath} is stale. Run: yarn workspace api swagger:generate`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('OpenAPI document is current.');
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  console.log(`OpenAPI document generated at ${outputPath}`);
}

generateOpenApi().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
