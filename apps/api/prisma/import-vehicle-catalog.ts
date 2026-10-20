import { PrismaClient, DataStatus } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

try { process.loadEnvFile('../../.env'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const prisma = new PrismaClient();
const sourceName = 'vehicle-makes-models · ODbL 1.0 · source communautaire non validée localement';
const sourceReference = 'https://github.com/gor3a/vehicle-makes-models';
const slugify = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
type SourceEngine = { label: string; fuelType?: string | null; displacementCc?: number | null; powerHp?: number | null; transmission?: string | null; drivetrain?: string | null };
type SourceGeneration = { name: string; yearStart: number; yearEnd?: number | null; bodyType?: string | null; engines?: SourceEngine[] };
type SourceModel = { name: string; yearStart?: number | null; yearEnd?: number | null; generations?: SourceGeneration[] };
type SourceMake = { name: string; models: SourceModel[] };
type SourceGroup = { makes: SourceMake[] };

async function main() {
  const jsonPath = path.resolve(process.cwd(), 'data/vehicle-makes-models.json.gz');
  const compressedSource = await readFile(jsonPath);
  const sourceData = JSON.parse(gunzipSync(compressedSource).toString('utf8')) as SourceGroup[];
  let makeCount = 0; let modelCount = 0; let generationCount = 0; let engineCount = 0; let variantCount = 0;
  for (const makeEntry of sourceData.flatMap((group) => group.makes)) {
    const makeSlug = slugify(makeEntry.name);
    let make = await prisma.vehicleMake.findUnique({ where: { slug: makeSlug } });
    if (!make) make = await prisma.vehicleMake.create({ data: { name: makeEntry.name, slug: makeSlug, status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference } });
    else if (make.status !== DataStatus.VERIFIED && (make.source !== sourceName || make.name !== makeEntry.name)) make = await prisma.vehicleMake.update({ where: { id: make.id }, data: { name: makeEntry.name, status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference } });
    makeCount++;
    for (const modelEntry of makeEntry.models) {
      const modelSlug = slugify(modelEntry.name);
      let model = await prisma.vehicleModel.findUnique({ where: { makeId_slug: { makeId: make.id, slug: modelSlug } } });
      if (!model) model = await prisma.vehicleModel.create({ data: { makeId: make.id, name: modelEntry.name, slug: modelSlug, category: 'Voiture particulière', status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference } });
      else if (model.status !== DataStatus.VERIFIED && (model.source !== sourceName || model.name !== modelEntry.name)) model = await prisma.vehicleModel.update({ where: { id: model.id }, data: { name: modelEntry.name, status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference } });
      modelCount++;
      for (const generationEntry of modelEntry.generations ?? []) {
        if (!Number.isInteger(generationEntry.yearStart) || generationEntry.yearStart < 1900 || generationEntry.yearStart > 2100) continue;
        const yearEnd = generationEntry.yearEnd && generationEntry.yearEnd >= generationEntry.yearStart ? generationEntry.yearEnd : null;
        let generation = await prisma.vehicleGeneration.findFirst({ where: { modelId: model.id, name: generationEntry.name, yearFrom: generationEntry.yearStart, yearTo: yearEnd } });
        if (!generation) generation = await prisma.vehicleGeneration.create({ data: { modelId: model.id, name: generationEntry.name, yearFrom: generationEntry.yearStart, yearTo: yearEnd, status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference } });
        else if (generation.status !== DataStatus.VERIFIED && generation.source !== sourceName) generation = await prisma.vehicleGeneration.update({ where: { id: generation.id }, data: { status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference } });
        generationCount++;
        const existingEngines = await prisma.engine.findMany({ where: { generationId: generation.id } });
        const engineByName = new Map(existingEngines.map((engine) => [engine.name, engine]));
        const seenEngineNames = new Set(engineByName.keys());
        const newEngineEntries = (generationEntry.engines ?? []).filter((engine) => {
          const name = engine.label?.trim();
          if (!name || seenEngineNames.has(name)) return false;
          seenEngineNames.add(name);
          return true;
        });
        if (newEngineEntries.length) {
          await prisma.engine.createMany({ data: newEngineEntries.map((engine) => ({ generationId: generation.id, name: engine.label.trim(), fuel: engine.fuelType?.trim() || null, displacementCc: Number.isInteger(engine.displacementCc) && engine.displacementCc! >= 50 && engine.displacementCc! <= 30000 ? engine.displacementCc : null, powerKw: typeof engine.powerHp === 'number' && engine.powerHp > 0 ? Math.round(engine.powerHp * 0.7457) : null, status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference })) });
          engineCount += newEngineEntries.length;
        }
        const engines = await prisma.engine.findMany({ where: { generationId: generation.id } });
        const existingVariants = await prisma.vehicleVariant.findMany({ where: { generationId: generation.id }, select: { engineId: true } });
        const variantEngineIds = new Set(existingVariants.map((variant) => variant.engineId).filter(Boolean));
        const sourceEngineByName = new Map((generationEntry.engines ?? []).filter((engine) => engine.label?.trim()).map((engine) => [engine.label.trim(), engine]));
        const newVariants = engines.filter((engine) => sourceEngineByName.has(engine.name) && !variantEngineIds.has(engine.id)).map((engine) => {
          const sourceEngine = sourceEngineByName.get(engine.name)!;
          const bodyStyle = generationEntry.bodyType?.trim() || null;
          return { generationId: generation.id, engineId: engine.id, name: bodyStyle || engine.name, bodyStyle, transmission: sourceEngine.transmission?.trim() || null, drivetrain: sourceEngine.drivetrain?.trim() || null, status: DataStatus.CONTRIBUTED, source: sourceName, sourceReference };
        });
        if (newVariants.length) { await prisma.vehicleVariant.createMany({ data: newVariants }); variantCount += newVariants.length; }
      }
    }
    console.info(`Import ${makeEntry.name} terminé.`);
  }
  console.info(`Import terminé : ${makeCount} marques parcourues, ${modelCount} modèles parcourus, ${generationCount} générations présentes, ${engineCount} motorisations ajoutées, ${variantCount} versions/carrosseries ajoutées. Statut : CONTRIBUTED (à vérifier).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
