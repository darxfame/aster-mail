// Original procedural sounds, released under CC0-1.0 with the generated WAV files.
const fs = require('node:fs'), path = require('node:path');
const sampleRate = 44100;
function sound(name, notes) {
  const length = Math.ceil((notes.at(-1)[0] + 0.65) * sampleRate), samples = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const value = notes.reduce((sum, [start, frequency]) => {
      const dt = t - start;
      if (dt < 0 || dt > 0.65) return sum;
      const envelope = Math.min(1, dt / 0.012) * Math.exp(-dt * 7) * Math.min(1, (0.65 - dt) / 0.04);
      return sum + envelope * (Math.sin(2 * Math.PI * frequency * dt) + 0.18 * Math.sin(4 * Math.PI * frequency * dt));
    }, 0);
    samples.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value * 0.26)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(samples.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples.length, 40);
  const dir = path.join(__dirname, '../assets/sounds'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), Buffer.concat([header, samples]));
}
sound('aster-mail.wav', [[0, 659.25], [0.14, 987.77]]);
sound('aster-meeting.wav', [[0, 523.25], [0.17, 659.25], [0.34, 783.99]]);
