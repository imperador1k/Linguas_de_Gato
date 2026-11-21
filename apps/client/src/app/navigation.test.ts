import { describe, expect, it } from 'vitest';
import { isProgressSection, isSettingsSection, legacyProgressTarget } from './legacy-routes';
import { MODULE_GROUP_ORDER, MODULES, PROGRESS_NAV, findModuleByPath, titleForPath } from './modules';

describe('legacy Progress URLs', () => {
  it('map every old section to its new place, keeping other parameters', () => {
    expect(legacyProgressTarget('?section=overview')).toBe('/progress');
    expect(legacyProgressTarget('?section=skills')).toBe('/progress/skills');
    expect(legacyProgressTarget('?section=errors')).toBe('/progress/mistakes');
    expect(legacyProgressTarget('?section=recommendations')).toBe('/progress/recommendations');
    expect(legacyProgressTarget('?section=training&category=prepositions')).toBe('/progress/training?category=prepositions');
    expect(legacyProgressTarget('?section=data')).toBe('/settings/data');
  });

  it('leave current URLs alone and send unknown sections to the overview', () => {
    expect(legacyProgressTarget('')).toBeNull();
    expect(legacyProgressTarget('?category=articles')).toBeNull();
    expect(legacyProgressTarget('?section=nonsense')).toBe('/progress');
  });

  it('recognise valid sections only', () => {
    expect(isProgressSection('mistakes')).toBe(true);
    expect(isProgressSection('errors')).toBe(false);
    expect(isProgressSection(undefined)).toBe(false);
    expect(isSettingsSection('data')).toBe(true);
    expect(isSettingsSection('backups')).toBe(false);
  });
});

describe('navigation model', () => {
  it('groups the modules as Practise, Language and Your progress, input skills first', () => {
    expect(MODULE_GROUP_ORDER).toEqual(['practise', 'language', 'progress']);
    expect(MODULES.filter((module) => module.group === 'practise').map((module) => module.label)).toEqual(['Listening', 'Reading', 'Speaking', 'Writing']);
    expect(MODULES.filter((module) => module.group === 'language').map((module) => module.label)).toEqual(['Grammar', 'Vocabulary']);
    expect(PROGRESS_NAV.map((item) => item.label)).toEqual(['Overview', 'Skills', 'Mistakes']);
  });

  it('keeps every detail route resolvable to its module', () => {
    for (const path of ['/speaking/attempts/a1', '/listening/session/s1', '/writing/tasks/t', '/grammar/sets/g', '/reading/texts/t', '/vocabulary/review', '/progress/mistakes']) {
      expect(findModuleByPath(path)).toBeDefined();
    }
  });

  it('titles Settings pages and modules', () => {
    expect(titleForPath('/settings/data')).toBe('Settings & data');
    expect(titleForPath('/speaking/attempts/a1')).toBe('Speaking');
    expect(titleForPath('/')).toBeNull();
  });

  it('marks the Progress overview as current on its related pages', () => {
    const overview = PROGRESS_NAV[0]!;
    expect(overview.alsoActive?.('/progress/recommendations')).toBe(true);
    expect(overview.alsoActive?.('/progress/skills')).toBe(false);
  });
});
