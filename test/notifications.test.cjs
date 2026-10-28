const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NotificationTracker, preferences } = require('../desktop/notifications.cjs');
const now = Date.parse('2026-10-28T10:00:00Z');
test('first mail snapshot is a silent baseline; old and read mail do not alert', () => {
  const t = new NotificationTracker();
  const old = { id: 'old', read: false, date: new Date(now - 1000).toISOString() };
  assert.deepEqual(t.newMail([old], now), []);
  const fresh = { id: 'fresh', read: false, date: new Date(now + 1000).toISOString() };
  const read = { ...fresh, id: 'read', read: true };
  const historical = { ...old, id: 'shifted-page' };
  assert.deepEqual(t.newMail([fresh, old, read, historical], now + 60000).map(m => m.id), ['fresh']);
  assert.deepEqual(t.newMail([fresh], now + 120000), []);
});
test('meetings notify once within the lead time and moved meetings can notify again', () => {
  const t = new NotificationTracker();
  const event = { id: 'e', start: new Date(now + 10 * 60000).toISOString() };
  assert.equal(t.reminders([event], 5, now).length, 0);
  assert.equal(t.reminders([event], 15, now).length, 1);
  assert.equal(t.reminders([event], 15, now + 60000).length, 0);
  assert.equal(t.reminders([{ ...event, start: new Date(now + 14 * 60000).toISOString() }], 15, now).length, 1);
});
test('all-day, cancelled, declined, and expired events do not produce reminders', () => {
  const t = new NotificationTracker(), event = { id: 'e', start: new Date(now + 5 * 60000).toISOString() };
  assert.deepEqual(t.reminders([{ ...event, allDay: true }, { ...event, cancelled: true }, { ...event, response: 'Decline' }, { ...event, start: new Date(now - 120000).toISOString() }], 15, now), []);
});
test('zero-minute reminders tolerate one polling interval after start', () => {
  const t = new NotificationTracker(), event = { id: 'e', start: new Date(now + 30000).toISOString() };
  assert.equal(t.reminders([event], 0, now).length, 0);
  assert.equal(t.reminders([event], 0, now + 60000).length, 1);
  assert.equal(t.reminders([event], 0, now + 65000).length, 0);
});
test('settings reject invalid reminder times and preserve disabled notifications', () => {
  assert.equal(preferences({ minutes: -10 }).minutes, 15);
  assert.equal(preferences({ minutes: '30', mail: false, meetings: false, sounds: false }).minutes, 30);
  assert.equal(preferences({ mail: false }).mail, false);
});
test('both original notification sounds are valid, different PCM WAV assets', () => {
  const sounds = ['aster-mail.wav', 'aster-meeting.wav'].map(name => fs.readFileSync(path.join(__dirname, '../assets/sounds', name)));
  for (const sound of sounds) {
    assert.equal(sound.toString('ascii', 0, 4), 'RIFF'); assert.equal(sound.toString('ascii', 8, 12), 'WAVE');
    assert.equal(sound.readUInt16LE(20), 1); assert.equal(sound.readUInt32LE(24), 44100); assert.equal(sound.readUInt32LE(40) + 44, sound.length);
    assert.ok(sound.length > 44100);
  }
  assert.ok(!sounds[0].equals(sounds[1]));
});
