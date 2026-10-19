import * as fs from 'fs';
import * as path from 'path';

import {
  KNOWN_OPERATING_MODES,
  resolveOperatingModeSyncAction,
  shouldWriteOperatingModeToBattery,
} from '../domain/OperatingModes';

const appRoot = path.join(__dirname, '..');

function readJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(appRoot, relativePath), 'utf-8'));
}

/** Recursively find all objects matching the predicate in a JSON structure. */
function findNodes(node: unknown, predicate: (o: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  if (Array.isArray(node)) {
    for (const item of node) {
      found.push(...findNodes(item, predicate));
    }
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (predicate(record)) {
      found.push(record);
    }
    for (const value of Object.values(record)) {
      found.push(...findNodes(value, predicate));
    }
  }
  return found;
}

/** Returns the sorted mode ids of every operating_mode dropdown found, one group per dropdown. */
function dropdownIdGroups(compose: unknown, key: 'id' | 'name'): string[][] {
  const dropdowns = findNodes(
    compose,
    (o) => o[key] === 'operating_mode' && o.type === 'dropdown' && Array.isArray(o.values),
  );
  expect(dropdowns.length).toBeGreaterThan(0);
  return dropdowns.map((d) => (d.values as Array<{ id: string }>).map((v) => v.id).sort());
}

describe('operating mode consistency across app files', () => {
  const expected = [...KNOWN_OPERATING_MODES].sort();

  it('KNOWN_OPERATING_MODES contains no duplicates', () => {
    expect(new Set(KNOWN_OPERATING_MODES).size).toBe(KNOWN_OPERATING_MODES.length);
  });

  it('matches the settings dropdown in driver.settings.compose.json', () => {
    const compose = readJson('drivers/sonnenbatterie/driver.settings.compose.json');
    for (const ids of dropdownIdGroups(compose, 'id')) {
      expect(ids).toEqual(expected);
    }
  });

  it('matches every operating_mode flow dropdown in driver.flow.compose.json', () => {
    const compose = readJson('drivers/sonnenbatterie/driver.flow.compose.json');
    for (const ids of dropdownIdGroups(compose, 'name')) {
      expect(ids).toEqual(expected);
    }
  });

  it.each(['en', 'de', 'da', 'nl'])(
    'matches the operatingMode translations in locales/%s.json',
    (locale) => {
      const translations = readJson(`locales/${locale}.json`) as { operatingMode: Record<string, string> };
      expect(Object.keys(translations.operatingMode).sort()).toEqual(expected);
    },
  );
});

describe('resolveOperatingModeSyncAction', () => {
  it('skips when the battery reported nothing', () => {
    expect(resolveOperatingModeSyncAction(null, '10')).toBe('skip-unchanged');
  });

  it('reports unknown modes outside the dropdown instead of syncing them', () => {
    expect(resolveOperatingModeSyncAction('8', '10')).toBe('unknown');
    expect(resolveOperatingModeSyncAction('8', undefined)).toBe('unknown');
  });

  it('syncs when the stored setting differs from the reported mode', () => {
    expect(resolveOperatingModeSyncAction('11', '10')).toBe('sync');
    expect(resolveOperatingModeSyncAction('11', undefined)).toBe('sync');
  });

  it('skips when the stored setting already matches the reported mode', () => {
    expect(resolveOperatingModeSyncAction('11', '11')).toBe('skip-unchanged');
  });

  it('respects a custom known-modes list', () => {
    expect(resolveOperatingModeSyncAction('10', undefined, ['1', '2'])).toBe('unknown');
    expect(resolveOperatingModeSyncAction('10', undefined, ['1', '2', '10'])).toBe('sync');
  });
});

describe('shouldWriteOperatingModeToBattery', () => {
  it('writes when nothing was reported yet (e.g. before the first poll)', () => {
    expect(shouldWriteOperatingModeToBattery('10', null)).toBe(true);
  });

  it('writes a genuine user change', () => {
    expect(shouldWriteOperatingModeToBattery('11', '10')).toBe(true);
  });

  it('skips the echo of a programmatic sync back to the battery', () => {
    expect(shouldWriteOperatingModeToBattery('11', '11')).toBe(false);
  });
});
