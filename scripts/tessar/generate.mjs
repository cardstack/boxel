import { createHash } from 'node:crypto';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

// Synthetic workload proportions, not production records or identifiers.
export const counts = {
  Classroom: 2,
  Student: 13,
  Staff: 26,
  Slot: 173,
  Observation: 164,
  Report: 44,
  Activity: 63,
  Reference: 766,
  DaySummary: 4,
};
export const presets = { smoke: 0, '1x': 1, '10x': 10 };
export const day = '2026-01-12';
export const nextDay = '2026-01-13';
const moduleRef = '../tessar';

export function generate({
  preset = 'smoke',
  seed = 1729,
  shape = 'distributed',
} = {}) {
  if (!Object.hasOwn(presets, preset))
    throw new Error('Preset must be smoke, 1x or 10x');
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error('Seed must be a nonnegative safe integer');
  if (!['distributed', 'focused'].includes(shape))
    throw new Error('Unknown workload shape');
  let scale = presets[preset];
  let sizes = Object.fromEntries(
    Object.entries(counts).map(([type, count]) => [
      type,
      scale ? count * scale : Math.min(count, 4),
    ]),
  );
  sizes.Classroom = scale ? 2 * scale : 2;
  let state = seed >>> 0;
  let random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  let id = (type, index) => `${type}/${String(index).padStart(5, '0')}`;
  let records = new Map();
  for (let [type, count] of Object.entries(sizes)) {
    for (let i = 0; i < count; i++) {
      let classroom = i % (shape === 'focused' ? 2 : sizes.Classroom);
      let attributes = {
        label: `Tessar ${type} ${String(i).padStart(5, '0')}`,
        classroomKey: `room-${classroom}`,
        day: Math.floor(i / sizes.Classroom) % 2 ? nextDay : day,
        sequence: i,
        score: Math.floor(random() * 101),
        status: i % 3 === 0 ? 'ready' : 'pending',
        narrative: `Synthetic Tessar record ${i}. `.repeat(
          type === 'Reference' ? 12 : 3,
        ),
      };
      let relationships;
      if (['Slot', 'Observation', 'Report', 'Activity'].includes(type)) {
        relationships = {
          student: {
            links: { self: `../${id('Student', i % sizes.Student)}` },
          },
          reference: {
            links: { self: `../${id('Reference', i % sizes.Reference)}` },
          },
          staff: { links: { self: `../${id('Staff', i % sizes.Staff)}` } },
        };
      }
      records.set(id(type, i), {
        data: {
          type: 'card',
          attributes,
          ...(relationships ? { relationships } : {}),
          meta: { adoptsFrom: { module: moduleRef, name: type } },
        },
      });
    }
  }
  return { records, sizes, seed, preset, shape };
}

// Reference implementation deliberately operates on raw fixture documents,
// independently of CardDef getters, query fields, server results or the UI.
export function expectedSummary(records, ownerId) {
  let owner = records.get(ownerId).data.attributes;
  let expected = {
    studentCount: 0,
    slotCount: 0,
    observationCount: 0,
    reportCount: 0,
    readyReportCount: 0,
    scoreTotal: 0,
    rows: [],
  };
  for (let [sourceId, { data }] of records) {
    let attrs = data.attributes;
    if (attrs.classroomKey !== owner.classroomKey) continue;
    let type = data.meta.adoptsFrom.name;
    if (type === 'Student') expected.studentCount++;
    if (attrs.day !== owner.day) continue;
    if (type === 'Observation') {
      expected.observationCount++;
      expected.scoreTotal += attrs.score;
    }
    if (type === 'Report') {
      expected.reportCount++;
      if (attrs.status === 'ready') expected.readyReportCount++;
    }
    if (type === 'Slot') {
      expected.slotCount++;
      let studentId = data.relationships.student.links.self.slice(3);
      let referenceId = data.relationships.reference.links.self.slice(3);
      expected.rows.push({
        sourceId,
        label: attrs.label,
        sequence: attrs.sequence,
        status: attrs.status,
        studentLabel: records.get(studentId).data.attributes.label,
        referenceLabel: records.get(referenceId).data.attributes.label,
      });
    }
  }
  expected.rows.sort((a, b) => a.sequence - b.sequence);
  return expected;
}

export function validateSummary(actual, expected) {
  let keys = Object.keys(expected);
  let normalized = Object.fromEntries(keys.map((key) => [key, actual[key]]));
  if (!isDeepStrictEqual(normalized, expected))
    throw new Error(
      `Tessar result mismatch: ${JSON.stringify({ expected, actual: normalized })}`,
    );
}

export async function writeDataset(output, options) {
  let dataset = generate(options);
  // Exclusive root creation avoids overwriting an existing run or real realm.
  await mkdir(output);
  let realmDir = join(output, 'realm');
  await mkdir(realmDir);
  await copyFile(
    new URL('./realm/tessar.gts', import.meta.url),
    join(realmDir, 'tessar.gts'),
  );
  let hash = createHash('sha256');
  for (let [id, document] of dataset.records) {
    let bytes = JSON.stringify(document) + '\n';
    hash.update(id).update('\0').update(bytes);
    await mkdir(join(realmDir, id.split('/')[0]), { recursive: true });
    await writeFile(join(realmDir, `${id}.json`), bytes);
  }
  let expected = Object.fromEntries(
    [...dataset.records.keys()]
      .filter((id) => id.startsWith('DaySummary/'))
      .map((id) => [id, expectedSummary(dataset.records, id)]),
  );
  let manifest = {
    version: 1,
    synthetic: true,
    seed: dataset.seed,
    preset: dataset.preset,
    shape: dataset.shape,
    instanceCount: dataset.records.size,
    counts: dataset.sizes,
    recordsSha256: hash.digest('hex'),
  };
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await writeFile(
    join(output, 'expected.json'),
    JSON.stringify(expected, null, 2) + '\n',
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let { values } = parseArgs({
    options: {
      output: { type: 'string' },
      preset: { type: 'string', default: 'smoke' },
      seed: { type: 'string', default: '1729' },
      shape: { type: 'string', default: 'distributed' },
    },
  });
  if (!values.output) throw new Error('--output must name a new directory');
  console.log(
    JSON.stringify(
      await writeDataset(resolve(values.output), {
        preset: values.preset,
        seed: Number(values.seed),
        shape: values.shape,
      }),
    ),
  );
}
