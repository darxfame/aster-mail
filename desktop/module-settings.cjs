const tr = require('../src/i18n.js').text;
function invalid() { throw new Error(tr('Не удалось безопасно перенести настройки модуля. Прежняя версия сохранена.')); }
function version(value) { return Number.isInteger(value) && value >= 1 && value <= 1000; }
function path(value) { return Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every(key => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) && !['constructor', 'prototype'].includes(key)); }
function validate(definition) {
  definition.settingsVersion ??= 1;
  if (!version(definition.settingsVersion)) invalid();
  if (definition.settingsMigrations === undefined) return;
  if (!Array.isArray(definition.settingsMigrations) || definition.settingsMigrations.length > 20) invalid();
  const starts = new Set();
  for (const step of definition.settingsMigrations) {
    if (!step || Object.keys(step).some(key => !['from', 'to', 'operations'].includes(key)) || !version(step.from) || step.to !== step.from + 1 || step.to > definition.settingsVersion || starts.has(step.from) || !Array.isArray(step.operations) || step.operations.length > 50) invalid();
    starts.add(step.from);
    for (const operation of step.operations) {
      if (!operation || !path(operation.path) || !['rename', 'setDefault'].includes(operation.op) || Object.keys(operation).some(key => !['op', 'path', ...(operation.op === 'rename' ? ['from'] : ['value'])].includes(key))) invalid();
      if (operation.op === 'setDefault' && !Object.hasOwn(operation, 'value')) invalid();
      if (operation.op === 'rename' && (!path(operation.from) || operation.from.slice(0, Math.min(operation.from.length, operation.path.length)).every((key, i) => key === operation.path[i]))) invalid();
    }
  }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parent(root, keys, create) {
  let value = root;
  for (const key of keys.slice(0, -1)) {
    if (!object(value)) invalid();
    if (!Object.hasOwn(value, key)) { if (!create) return null; value[key] = {}; }
    value = value[key];
  }
  if (!object(value)) invalid();
  return value;
}
function migrate(data, from, definition) {
  const copy = JSON.parse(JSON.stringify(data));
  if (!version(from) || from > definition.settingsVersion) invalid();
  while (from < definition.settingsVersion) {
    const step = (definition.settingsMigrations || []).find(item => item.from === from);
    if (!step) invalid();
    for (const operation of step.operations) {
      const key = operation.path.at(-1);
      if (operation.op === 'setDefault') { const target = parent(copy, operation.path, true); if (!Object.hasOwn(target, key)) target[key] = JSON.parse(JSON.stringify(operation.value)); }
      else {
        const source = parent(copy, operation.from, false), sourceKey = operation.from.at(-1);
        if (!source || !Object.hasOwn(source, sourceKey)) continue;
        const target = parent(copy, operation.path, true);
        if (Object.hasOwn(target, key)) invalid();
        target[key] = source[sourceKey]; delete source[sourceKey];
      }
    }
    from = step.to;
  }
  if (Buffer.byteLength(JSON.stringify(copy)) > 16000) invalid();
  return copy;
}
function newer(next, previous) {
  const a = next.split('.').map(BigInt), b = previous.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
module.exports = { validate, migrate, newer, version };
