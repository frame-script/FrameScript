"""The music of the showcase, made from nothing: 40 s at 120 BPM in A minor, 48 kHz stereo.

    python3 music.py assets/music.wav

Bars are 2 s. What is heard follows the scenes of main.tsx (see beat.ts, which has the same bars):
  0-2   intro    a pad that comes up, and a riser into the drop
  3-6   city     the beat
  7-10  studio   the beat, and an arpeggio
  11-13 run      the same, with open hats
  14-16 code     no drums: the pad and the arpeggio, and a riser
  17-19 outro    a last hit and a chord that rings out
"""

import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
LENGTH = 40.0
N = int(LENGTH * SR)
rng = np.random.default_rng(7)

# Am, F, C, G, as MIDI notes.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lowpass(x, cutoff, order=2):
    return sosfilt(butter(order, cutoff, "low", fs=SR, output="sos"), x)


def highpass(x, cutoff, order=2):
    return sosfilt(butter(order, cutoff, "high", fs=SR, output="sos"), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def saw(f, n, phase=0.0):
    """A band-limited sawtooth (polyBLEP)."""
    dt = f / SR
    p = (phase + dt * np.arange(n)) % 1.0
    out = 2 * p - 1
    a = p < dt
    t = p[a] / dt
    out[a] -= t + t - t * t - 1
    b = p > 1 - dt
    t = (p[b] - 1) / dt
    out[b] -= t * t + t + t + 1
    return out


def adsr(n, a, d, s, r, hold):
    """Attack, decay, sustain level and release in seconds, held for `hold` seconds; `n` samples long."""
    t = np.arange(n) / SR
    env = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    after = t > hold
    level = np.interp(hold, t, env) if n else 0
    env[after] = level * np.exp(-(t[after] - hold) / max(r, 1e-6))
    return env


class Mix:
    def __init__(self):
        self.dry = np.zeros((N, 2))
        self.send = np.zeros((N, 2))
        # What ducks under the kick.
        self.ducked = np.zeros((N, 2))

    def add(self, at, sound, pan=0.0, send=0.0, duck=False):
        i = int(at * SR)
        if i >= N:
            return
        sound = sound[: N - i]
        stereo = sound if sound.ndim == 2 else np.stack([sound * (1 - max(pan, 0)), sound * (1 + min(pan, 0))], 1)
        (self.ducked if duck else self.dry)[i : i + len(stereo)] += stereo
        self.send[i : i + len(stereo)] += stereo * send


def kick():
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 46 + 130 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.32)
    click = highpass(rng.standard_normal(n), 3000) * np.exp(-t / 0.004) * 0.3
    return np.tanh((body + click) * 1.8) * 0.75


def clap():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    noise = bandpass(rng.standard_normal(n), 900, 3500)
    env = np.zeros(n)
    for k, d in enumerate([0.0, 0.011, 0.022]):
        tt = t - d
        env += np.where(tt >= 0, np.exp(-np.clip(tt, 0, None) / (0.012 if k < 2 else 0.14)), 0)
    return noise * env * 0.5


def hat(open_=False):
    n = int((0.3 if open_ else 0.08) * SR)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 7500, 4) * np.exp(-t / (0.11 if open_ else 0.022)) * 0.22


def pluck(m, length=0.6, bright=1.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    out = np.zeros(n)
    for k in range(1, 8):
        if f * k > 16000:
            break
        out += np.sin(2 * np.pi * f * k * t) / k**1.4 * np.exp(-t * (3 + k * 4 / bright))
    return out * np.minimum(t / 0.002, 1) * 0.35


def pad(chord, length):
    n = int((length + 1.5) * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for m in chord + [chord[0] - 12]:
        for j, cents in enumerate([-14, -6, 0, 7, 15]):
            s = saw(hz(m) * 2 ** (cents / 1200), n, rng.random())
            if j % 2:
                left += s * 0.8
                right += s * 0.4
            else:
                left += s * 0.4
                right += s * 0.8
    env = adsr(n, 0.35, 1.0, 0.85, 0.9, length)
    st = np.stack([lowpass(left, 1600), lowpass(right, 1600)], 1)
    return st * env[:, None] * 0.055


def bass(m, length):
    n = int((length + 0.1) * SR)
    t = np.arange(n) / SR
    s = lowpass(saw(hz(m), n), 420) * 0.5 + np.sin(2 * np.pi * hz(m - 12) * t) * 0.6
    return s * adsr(n, 0.004, 0.15, 0.7, 0.04, length) * 0.42


def riser(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = t / length
    noise = rng.standard_normal(n)
    # Band-passed noise whose band climbs, in short blocks that carry the filter's state on.
    out = np.zeros(n)
    block = 512
    state = np.zeros((2, 2))
    for i in range(0, n, block):
        c = 300 * (40 ** x[i])
        sos = butter(2, [c * 0.7, min(c * 1.4, 20000)], "band", fs=SR, output="sos")
        out[i : i + block], state = sosfilt(sos, noise[i : i + block], zi=state)
    tone = np.sin(2 * np.pi * np.cumsum(200 * 8 ** x) / SR) * 0.15
    return (out * 0.5 + tone) * x**2.2 * 0.5


def impact():
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(32 + 40 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.7)
    crash = highpass(rng.standard_normal(n), 3500) * np.exp(-t / 0.9) * 0.18
    return np.tanh(boom * 1.4) * 0.8 + crash


def reverb(x, seconds=2.4):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([lowpass(rng.standard_normal(n), 7000) * np.exp(-t / 0.55) for _ in range(2)], 1)
    ir /= np.sqrt((ir**2).sum(0))
    return np.stack([fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], 1)


def main(path):
    mix = Mix()
    bar = lambda b: b * BAR

    # Pads, every bar but the last three, which ring the one chord.
    for b in range(17):
        mix.add(bar(b), pad(CHORDS[b % 4], BAR), send=0.6, duck=True)
    mix.add(bar(17), pad([57, 60, 64, 69], 4.5) * 1.3, send=0.8)

    # The beat: from the drop to the breakdown.
    k = kick()
    for b in range(3, 14):
        for beat in range(4):
            at = bar(b) + beat * BEAT
            mix.add(at, k)
            if beat in (1, 3):
                mix.add(at, clap(), send=0.25)
            # Hats on the off-beats, and on every 16th from the studio.
            mix.add(at + BEAT / 2, hat(open_=b >= 11), pan=0.2)
            if b >= 7:
                mix.add(at + BEAT / 4, hat() * 0.5, pan=-0.25)
                mix.add(at + BEAT * 3 / 4, hat() * 0.5, pan=-0.25)
    mix.add(bar(17), k)

    # Bass: eighths on the root of the bar's chord.
    for b in range(3, 14):
        root = ROOTS[b % 4]
        for e in range(8):
            mix.add(bar(b) + e * BEAT / 2, bass(root + (12 if e % 4 == 3 else 0), BEAT / 2 * 0.8), duck=True)

    # Arpeggio from the studio to the end of the breakdown, quieter and darker there.
    for b in range(7, 17):
        chord = CHORDS[b % 4]
        notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24]
        order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2]
        level = 0.8 if b >= 14 else 1.0
        for s in range(16):
            mix.add(
                bar(b) + s * BEAT / 4,
                pluck(notes[order[s]], 0.5, bright=0.5 if b >= 14 else 1.0) * level,
                pan=0.35 if s % 2 else -0.35,
                send=0.35,
                duck=True,
            )

    # Bells over the last chord.
    for i, (beat, m) in enumerate([(0, 76), (1, 72), (2, 69), (3, 72), (4.5, 76), (6, 81)]):
        mix.add(bar(17) + beat * BEAT, pluck(m, 3.0, bright=3.0) * 0.6, pan=(-0.3, 0.3)[i % 2], send=0.7)

    # Risers into each scene, a hit at each.
    for start, length in [(bar(1), BAR * 2), (bar(6) + BAR / 2, BAR / 2), (bar(10) + BAR / 2, BAR / 2),
                          (bar(13) + BAR * 3 / 4, BAR / 4), (bar(16), BAR)]:
        mix.add(start, riser(length), send=0.3)
    for b in (3, 7, 11, 14, 17):
        mix.add(bar(b), impact() * (1.2 if b in (3, 17) else 0.7), send=0.5)
    # A roll of claps up to the drop and up to the end.
    for b in (2, 16):
        for i in range(16):
            mix.add(bar(b) + i * BEAT / 4, clap() * (0.15 + 0.6 * i / 15), send=0.3)

    # The kick ducks what holds notes.
    t = np.arange(N) / SR
    duck = np.ones(N)
    for b in range(3, 14):
        for beat in range(4):
            at = bar(b) + beat * BEAT
            i = int(at * SR)
            span = t[i : i + int(BEAT * SR)] - at
            duck[i : i + len(span)] = 1 - 0.65 * np.exp(-span / 0.12)
    out = mix.dry + mix.ducked * duck[:, None]
    out += reverb(mix.send) * 0.35
    # Gently fade the last seconds, then keep it from clipping.
    out *= np.clip((LENGTH - t) / 3.0, 0, 1)[:, None]
    out = np.tanh(out * 1.1)
    out *= 0.9 / np.abs(out).max()
    wavfile.write(path, SR, (out * 32767).astype(np.int16))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/music.wav")
