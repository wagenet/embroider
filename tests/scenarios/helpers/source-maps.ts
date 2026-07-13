import { readFileSync } from 'fs';
import globby from 'globby';
import { TraceMap, eachMapping, sourceContentFor } from '@jridgewell/trace-mapping';

export interface VariableMapping {
  source: string;
  originalLine: number;
  originalColumn: number;
  generatedLine: number;
  generatedColumn: number;
  name: string | null;
  originalLineText: string | undefined;
}

/**
 * Finds a mapping that ties a compiled reference back to `variable` in
 * `originalFile` — either because the mapping carries the original identifier
 * name (exactly what a debugger resolves) or because the mapped source line
 * still contains the identifier. Returns `undefined` if no such mapping exists.
 */
export function findVariableMapping(
  tracer: TraceMap,
  originalFile: string,
  variable: string
): VariableMapping | undefined {
  let match: VariableMapping | undefined;

  eachMapping(tracer, mapping => {
    if (match) {
      return;
    }
    let { source, originalLine, originalColumn } = mapping;
    if (source == null || originalLine == null || !source.includes(originalFile)) {
      return;
    }
    let lineText = sourceContentFor(tracer, source)?.split('\n')[originalLine - 1];
    if (mapping.name === variable || lineText?.includes(variable)) {
      match = {
        source,
        originalLine,
        originalColumn: originalColumn ?? -1,
        generatedLine: mapping.generatedLine,
        generatedColumn: mapping.generatedColumn,
        name: mapping.name ?? null,
        originalLineText: lineText,
      };
    }
  });

  return match;
}

/**
 * Asserts that a variable referenced from inside a `<template>` maps back to
 * `originalFile`, and that the map embeds the source content a debugger needs to
 * display it.
 */
export function assertTemplateVariableMapsToSource(
  assert: Assert,
  opts: { rawMap: unknown; originalFile: string; variable: string; label: string }
): void {
  let { rawMap, originalFile, variable, label } = opts;
  let tracer = new TraceMap(rawMap as ConstructorParameters<typeof TraceMap>[0]);

  let match = findVariableMapping(tracer, originalFile, variable);
  assert.ok(
    match,
    `${label}: "${variable}" maps back into ${originalFile}` +
      (match ? ` (line ${match.originalLine}: "${match.originalLineText?.trim()}")` : '')
  );
  if (!match) {
    return;
  }

  assert.ok(
    sourceContentFor(tracer, match.source) != null,
    `${label}: map embeds ${originalFile} contents (needed for debugger display)`
  );
}

/**
 * Searches every `.map` under `distDir` for one that maps `variable` back into
 * `originalFile`. Useful for bundled/hashed output where the chunk filename
 * isn't known ahead of time.
 */
export async function findMapForVariable(
  distDir: string,
  originalFile: string,
  variable: string
): Promise<{ mapFile: string; rawMap: unknown } | undefined> {
  let mapFiles = await globby('**/*.map', { cwd: distDir, absolute: true });
  for (let mapFile of mapFiles) {
    let rawMap = JSON.parse(readFileSync(mapFile, 'utf8'));
    if (findVariableMapping(new TraceMap(rawMap), originalFile, variable)) {
      return { mapFile, rawMap };
    }
  }
  return undefined;
}
