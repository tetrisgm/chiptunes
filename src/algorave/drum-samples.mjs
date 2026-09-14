// Original procedural drum recordings, rendered once into ordinary PCM samples.
// Strudel plays these through its upstream sampler, including speed/slicing.
export function drumWav(kind, sampleRate = 22050) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw Error('Invalid sample rate.');
  if (!['bd', 'sd', 'hh'].includes(kind)) throw Error('Unknown drum.');
  const duration = kind === 'bd' ? .45 : kind === 'sd' ? .22 : .09;
  const count = Math.ceil(duration * sampleRate);
  const data = new ArrayBuffer(44 + count * 2), view = new DataView(data);
  const word = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, count * 2, true);
  let state = 73451, previous = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = state / 2147483648 - 1;
    const attack = Math.min(1, t / .0015);
    let sample;
    if (kind === 'bd') {
      const phase = 2 * Math.PI * (48 * t + 115 * .025 * (1 - Math.exp(-t / .025)));
      sample = Math.sin(phase) * Math.exp(-t * 13);
    } else if (kind === 'sd') {
      sample = (.68 * noise + .32 * Math.sin(2 * Math.PI * 180 * t)) * Math.exp(-t * 25);
    } else sample = (noise - previous) * .45 * Math.exp(-t * 65);
    previous = noise;
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample * attack * .8)) * 32767), true);
  }
  return data;
}
