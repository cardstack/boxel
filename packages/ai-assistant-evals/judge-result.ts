#!/usr/bin/env node
// Records a judge's verdict on an EvaluationResultCard: the quality score
// (0 to 10, against the evaluation's success criteria) and the written
// analysis. The card computes its effectiveness score and tier from them.
//
//   node judge-result.ts <result-card-url> --score 8 --analysis-file notes.md
//   node judge-result.ts <result-card-url> --score 0 --analysis "No card was written."

import { readFile } from 'node:fs/promises';

import { loginWithPassword } from './matrix-api.ts';
import { RealmClient } from './realm-api.ts';
import { WRITER_PASSWORD, WRITER_USER } from './eval-config.ts';

interface Args {
  cardUrl: string;
  score: number;
  analysis: string;
}

async function parseArgs(argv: string[]): Promise<Args> {
  let cardUrl = '';
  let score: number | undefined;
  let analysis: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--score') {
      score = Number(argv[++i]);
    } else if (arg === '--analysis') {
      analysis = argv[++i];
    } else if (arg === '--analysis-file') {
      analysis = await readFile(argv[++i], 'utf8');
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      cardUrl = arg;
    }
  }
  if (
    !cardUrl ||
    score === undefined ||
    Number.isNaN(score) ||
    score < 0 ||
    score > 10 ||
    analysis === undefined
  ) {
    throw new Error(
      'usage: node judge-result.ts <result-card-url> --score <0-10> (--analysis "<text>" | --analysis-file <path>)',
    );
  }
  return { cardUrl, score, analysis };
}

async function main() {
  let args = await parseArgs(process.argv.slice(2));
  let credentials = await loginWithPassword(WRITER_USER, WRITER_PASSWORD);
  let client = new RealmClient(credentials.accessToken, credentials.userId);
  let realmUrl = await client.realmOf(args.cardUrl);
  let current = await client.getCard(realmUrl, args.cardUrl);
  let updated = await client.patchCard(realmUrl, args.cardUrl, {
    data: {
      type: 'card',
      attributes: {
        qualityScore: args.score,
        analysis: args.analysis,
      },
      meta: { adoptsFrom: current.data.meta.adoptsFrom },
    },
  });
  let attributes = updated.data.attributes ?? {};
  console.log(
    `[judge] ${args.cardUrl}: quality ${args.score}/10` +
      (attributes.effectivenessScore != null
        ? `, effectiveness ${attributes.effectivenessScore} (${attributes.effectivenessTier})`
        : ''),
  );
}

main().catch((error) => {
  console.error(
    `[judge] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
