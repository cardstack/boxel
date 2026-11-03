import { z } from 'zod';
import type {
  NativeManagedEnvironment,
  NativeEnvironmentCreate,
} from './contracts.ts';

export const EnvironmentCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('official') }).strict(),
      z
        .object({
          kind: z.literal('checkout'),
          path: z.string().min(1),
          ref: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/),
        })
        .strict(),
    ]),
  })
  .strict() satisfies z.ZodType<NativeEnvironmentCreate>;
export const EnvironmentActionSchema = z.enum([
  'prepare',
  'test',
  'build',
  'run',
  'stop',
]);
export const EnvironmentSchema = z
  .object({
    id: z.string().regex(/^bxenv_[a-f0-9]{12}$/),
    name: z.string().min(1).max(60),
    branch: z.string().min(1),
    path: z.string().min(1),
    namespace: z.string().regex(/^env-[a-f0-9]{12}$/),
    gatewayPort: z.number().int().min(1024).max(65535),
    controlPort: z.number().int().min(1024).max(65535),
    modelsPort: z.number().int().min(1024).max(65535),
    url: z.url(),
    state: z.enum(['preparing', 'ready', 'running', 'error']),
    error: z.string().nullable(),
    createdAt: z.iso.datetime(),
    job: z
      .object({
        id: z.uuid(),
        action: z.enum(['prepare', 'test', 'build', 'run', 'stop']),
        state: z.enum(['running', 'passed', 'failed', 'cancelled']),
        phase: z.string(),
        startedAt: z.iso.datetime(),
        finishedAt: z.iso.datetime().nullable(),
      })
      .strict()
      .nullable(),
    builtHash: z.string().nullable(),
    testedHash: z.string().nullable(),
    profileId: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<NativeManagedEnvironment>;
