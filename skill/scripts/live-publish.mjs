#!/usr/bin/env node

import {
  prepareGenerationArtifact,
  publishGenerationArtifact,
} from './live/generation-publisher.mjs';

const args = process.argv.slice(2);
const result = args.includes('--prepare')
  ? prepareGenerationArtifact({
      id: arg(args, '--id'),
      sourceFile: arg(args, '--file'),
    })
  : publishGenerationArtifact({
      id: arg(args, '--id'),
      epoch: Number(arg(args, '--epoch')),
      sourceFile: arg(args, '--file'),
      artifactFile: arg(args, '--artifact'),
      expectedSourceHash: arg(args, '--expected-source-hash'),
      arrivedVariants: optionalNumber(arg(args, '--arrived')),
      expectedVariants: optionalNumber(arg(args, '--expected')),
      publicationKind: arg(args, '--kind'),
    });

console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 2;

function arg(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function optionalNumber(value) {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}
