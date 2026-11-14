"""The music of the motion reel, made from nothing: 44 s at 120 BPM in D minor, 48 kHz stereo.

    python3 music.py assets/music.wav

Bars are 2 s, frames are 60 to the second, and both are those of beat.ts: the sounds that go with
what is seen are at the frames the scenes do it at.
  0-2   point    a pad, and a sound for each thing the dot does; the rings pull in to the drop
  3-5   title    the beat, a hit and a burst
  6-9   morph    the beat, and a note for each shape
  10-13 data     the beat, ticking counters and climbing bars
  14-15 pattern  no drums: the pad, an arpeggio, a shimmer for each wave of tiles
  16-17 build    the squares' twists as toms, faster and faster, a riser, the countdown
  18-20 finale   the drop, confetti, the mark and the name typed out
  21    end      a chord that rings, everything pulled into the point, and its going
"""

import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
LENGTH = 44.0
N = int(LENGTH * SR)
rng = np.random.default_rng(11)

# Dm, Bb, F, C, as MIDI notes.
CHORDS = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]]
ROOTS = [38, 34, 41, 36]
# D minor pentatonic, for the notes of things.
SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def frame(f):
    """Seconds at frame `f` of the project."""
    return f / 60


def bar(b):
    return b * BAR


def lowpass(x, cutoff, order=2):
    return sosfilt(butter(order, cutoff, "low", fs=SR, output="sos"), x)


def highpass(x, cutoff, order=2):
    return sosfilt(butter(order, cutoff, "high", fs=SR, output="sos"), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def saw(f, n, phase=0.0):
    """A band-limited sawtooth (polyBLEP); `f` a frequency or one per sample."""
    dt = np.broadcast_to(np.asarray(f, float) / SR, (n,))
    p = (phase + np.cumsum(dt) - dt[0]) % 1.0
    out = 2 * p - 1
    a = p < dt
    t = p[a] / dt[a]
    out[a] -= t + t - t * t - 1
    b = p > 1 - dt
    t = (p[b] - 1) / dt[b]
    out[b] -= t * t + t + t + 1
    return out


def adsr(n, a, d, s, r, hold):
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
        self.ducked = np.zeros((N, 2))

    def add(self, at, sound, pan=0.0, send=0.0, duck=False, gain=1.0):
        i = int(at * SR)
        if i >= N or i < 0:
            return
        sound = sound[: N - i] * gain
        stereo = sound if sound.ndim == 2 else np.stack([sound * (1 - max(pan, 0)), sound * (1 + min(pan, 0))], 1)
        (self.ducked if duck else self.dry)[i : i + len(stereo)] += stereo
        self.send[i : i + len(stereo)] += stereo * send


# --- Drums ---------------------------------------------------------------------------------------


def kick():
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    f = 48 + 140 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    click = highpass(rng.standard_normal(n), 3000) * np.exp(-t / 0.004) * 0.35
    return np.tanh((body + click) * 2.0) * 0.72


def clap():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    noise = bandpass(rng.standard_normal(n), 1000, 4000)
    env = np.zeros(n)
    for k, d in enumerate([0.0, 0.009, 0.019]):
        tt = t - d
        env += np.where(tt >= 0, np.exp(-np.clip(tt, 0, None) / (0.01 if k < 2 else 0.12)), 0)
    return noise * env * 0.5


def hat(open_=False):
    n = int((0.28 if open_ else 0.07) * SR)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 8000, 4) * np.exp(-t / (0.1 if open_ else 0.018)) * 0.2


def snare():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5
    noise = bandpass(rng.standard_normal(n), 1500, 9000) * np.exp(-t / 0.07)
    return (tone + noise) * 0.4


def tom(m):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = hz(m) * (1 + 0.6 * np.exp(-t / 0.03))
    return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18) * 1.5) * 0.45


# --- Notes ---------------------------------------------------------------------------------------


def pluck(m, length=0.6, bright=1.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    out = np.zeros(n)
    for k in range(1, 9):
        if f * k > 16000:
            break
        out += np.sin(2 * np.pi * f * k * t) / k**1.3 * np.exp(-t * (3 + k * 4 / bright))
    return out * np.minimum(t / 0.002, 1) * 0.33


def pad(chord, length):
    n = int((length + 1.5) * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for m in chord + [chord[0] - 12]:
        for j, cents in enumerate([-12, -5, 0, 6, 13]):
            s = saw(hz(m + 12) * 2 ** (cents / 1200), n, rng.random())
            if j % 2:
                left += s * 0.8
                right += s * 0.4
            else:
                left += s * 0.4
                right += s * 0.8
    env = adsr(n, 0.3, 1.0, 0.85, 0.9, length)
    st = np.stack([lowpass(left, 1900), lowpass(right, 1900)], 1)
    return st * env[:, None] * 0.045


def stab(chord):
    """A short bright chord, for the downbeats of the drops."""
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    out = sum(saw(hz(m + 24) * 2 ** (c / 1200), n, rng.random()) for m in chord for c in (-8, 8))
    return lowpass(out, 3500) * np.exp(-t / 0.12) * 0.06


def bass(m, length):
    n = int((length + 0.1) * SR)
    t = np.arange(n) / SR
    s = lowpass(saw(hz(m), n), 500) * 0.5 + np.sin(2 * np.pi * hz(m - 12) * t) * 0.6
    return s * adsr(n, 0.004, 0.12, 0.7, 0.04, length) * 0.4


# --- What goes with things seen ------------------------------------------------------------------


def pop(m=72):
    """A drop of water: a sine that bends up, quickly gone."""
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    f = hz(m) * (0.55 + 0.45 * (1 - np.exp(-t / 0.012)))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.045) * 0.5


def blip(m):
    """A square-ish note, short, for each shape."""
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    s = np.tanh(np.sin(2 * np.pi * hz(m) * t) * 3) + 0.4 * np.sin(2 * np.pi * hz(m + 12) * t)
    return lowpass(s, 4000) * np.exp(-t / 0.06) * 0.16


def tick():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return bandpass(rng.standard_normal(n), 2500, 7000) * np.exp(-t / 0.004) * 0.35


def woodblock(m=84):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * hz(m) * t) * np.exp(-t / 0.025) * 0.3


def whoosh(length, rising=True):
    """Noise through a band that sweeps, swelling and gone."""
    n = int(length * SR)
    x = np.arange(n) / n
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    block = 256
    state = np.zeros((2, 2))
    for i in range(0, n, block):
        k = x[i] if rising else 1 - x[i]
        c = 400 * (20 ** k)
        sos = butter(2, [c * 0.6, min(c * 1.6, 20000)], "band", fs=SR, output="sos")
        out[i : i + block], state = sosfilt(sos, noise[i : i + block], zi=state)
    env = np.sin(np.pi * x) ** 2
    return out * env * 0.55


def swell(length):
    """A reversed cymbal, into a hit."""
    n = int(length * SR)
    x = np.arange(n) / n
    return highpass(rng.standard_normal(n), 4000) * x**3 * 0.25


def riser(length):
    n = int(length * SR)
    x = np.arange(n) / n
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    block = 512
    state = np.zeros((2, 2))
    for i in range(0, n, block):
        c = 300 * (40 ** x[i])
        sos = butter(2, [c * 0.7, min(c * 1.4, 20000)], "band", fs=SR, output="sos")
        out[i : i + block], state = sosfilt(sos, noise[i : i + block], zi=state)
    tone = saw(220 * 4**x, n) * 0.08
    return lowpass(out * 0.5 + tone, 9000) * x**2.2 * 0.5


def impact(size=1.0):
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(30 + 45 * np.exp(-t / 0.07)) / SR) * np.exp(-t / 0.6)
    crash = highpass(rng.standard_normal(n), 3500) * np.exp(-t / 0.8) * 0.2
    return (np.tanh(boom * 1.4) * 0.8 + crash) * size


def sparkle(length):
    """Many small high notes, scattered: confetti."""
    n = int(length * SR)
    out = np.zeros(n)
    for k in range(60):
        at = int((rng.random() ** 1.8) * (n - SR * 0.2))
        p = pluck(rng.choice(SCALE) + 24, 0.2, bright=3.0) * (1 - at / n) * 0.35
        out[at : at + len(p)] += p
    return out


def boing(m=60):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = hz(m) * (1 + 0.5 * np.sin(2 * np.pi * 9 * t) * np.exp(-t / 0.12))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12) * 0.35


def reverb(x, seconds=2.4):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([lowpass(rng.standard_normal(n), 7000) * np.exp(-t / 0.5) for _ in range(2)], 1)
    ir /= np.sqrt((ir**2).sum(0))
    return np.stack([fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], 1)


def main(path):
    mix = Mix()
    beat_bars = list(range(3, 14)) + list(range(18, 21))

    # Pads all along, but for the last bar, which rings the one chord.
    for b in range(21):
        mix.add(bar(b), pad(CHORDS[b % 4], BAR), send=0.6, duck=True, gain=1.5 if b < 3 else 1.0)
    mix.add(bar(21), pad([50, 57, 62, 65], 3.5) * 1.3, send=0.8)

    # The beat.
    k = kick()
    for b in beat_bars:
        for beat in range(4):
            at = bar(b) + beat * BEAT
            mix.add(at, k)
            if beat in (1, 3):
                mix.add(at, clap(), send=0.25)
            mix.add(at + BEAT / 2, hat(open_=b in (10, 11, 12, 13, 19, 20)), pan=0.2)
            if b >= 6:
                mix.add(at + BEAT / 4, hat() * 0.45, pan=-0.25)
                mix.add(at + BEAT * 3 / 4, hat() * 0.45, pan=-0.25)
        mix.add(bar(b), stab(CHORDS[b % 4]), send=0.4, duck=True)
    for b in beat_bars:
        root = ROOTS[b % 4]
        for e in range(8):
            mix.add(bar(b) + e * BEAT / 2, bass(root + (12 if e % 4 == 3 else 0), BEAT / 2 * 0.8), duck=True)

    # An arpeggio through the morph, the breakdown and the build.
    for b in list(range(6, 10)) + list(range(14, 18)):
        chord = CHORDS[b % 4]
        notes = [chord[0] + 24, chord[1] + 24, chord[2] + 24, chord[0] + 36]
        order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2]
        dark = b in (14, 15)
        for s in range(16):
            mix.add(bar(b) + s * BEAT / 4, pluck(notes[order[s]], 0.45, bright=0.6 if dark else 1.0) * (0.7 if dark else 0.55),
                    pan=0.35 if s % 2 else -0.35, send=0.4, duck=not dark)

    # --- Point: what the dot does.
    mix.add(frame(30), pop(74), send=0.3)
    for i in range(3):
        mix.add(frame(60 + i * 4), pop(79 + i * 2) * 0.6, pan=(-0.5, 0, 0.5)[i], send=0.3)
        mix.add(frame(90 + i * 4), whoosh(0.6) * 0.35, pan=(-0.5, 0, 0.5)[i])
        mix.add(frame(118 + i * 5), pop([62, 69, 74][i]) * 0.9, pan=(-0.5, 0, 0.5)[i], send=0.4)
    mix.add(frame(150), boing(57), pan=-0.5, send=0.2)
    mix.add(frame(170), tick() * 2, pan=-0.5)
    mix.add(frame(180), woodblock(77), send=0.2)
    mix.add(frame(210), pop(81), pan=0.5, send=0.3)
    for b in range(3):
        for beat in range(4):
            mix.add(bar(b) + beat * BEAT, pluck(SCALE[[0, 3, 5, 3][beat]], 0.8, bright=0.7) * 0.7, send=0.5)
    # The rings, each a swell into where it closes.
    for start, length in [(236, 44), (262, 40), (284, 36), (300, 32), (312, 28), (322, 24), (330, 20), (336, 16)]:
        mix.add(frame(start), swell(length / 60) * 0.6, pan=rng.uniform(-0.3, 0.3))
    mix.add(bar(2), riser(BAR), send=0.3)
    mix.add(frame(343), pop(62) * 0.8)

    # --- Title.
    mix.add(bar(3), impact(1.2), send=0.5)
    mix.add(bar(3), whoosh(0.7) * 0.8)
    for i in range(7):
        mix.add(frame(360 + 240 + i * 30), woodblock(84 if i % 2 else 89) * 0.7, pan=-0.4, send=0.2)
    # The stripes over the cut into the morph.
    mix.add(frame(698), whoosh(0.8), send=0.2)

    # --- Morph: a note for each shape, up and down the scale.
    tune = [0, 2, 4, 3, 5, 4, 2, 1, 3, 5, 7, 6, 4, 6, 8, 9]
    for i in range(1, 16):
        mix.add(frame(720 + i * 30), blip(SCALE[tune[i]] + 12), pan=0.3 if i % 2 else -0.3, send=0.3)
    mix.add(frame(1160), riser(40 / 60) * 0.7)
    mix.add(bar(10), impact(0.7), send=0.4)

    # --- Data: counters tick as they count, bars climb.
    for f in range(1220, 1280, 2):
        mix.add(frame(f), tick() * (1 - (f - 1220) / 70), pan=-0.4)
    for i in range(9):
        mix.add(frame(1200 + 70 + i * 5), blip(SCALE[i % len(SCALE)] + 12) * 0.8, pan=0.5, send=0.2)
    for i in range(4):
        mix.add(frame(1200 + 40 + i * 12), pop(69 + i * 3) * 0.6, send=0.3)
    mix.add(frame(1330), whoosh(1.8) * 0.4, pan=0.2)
    mix.add(frame(1620), whoosh(0.9, rising=False) * 0.6)

    # --- Pattern: a shimmer for each wave of tiles.
    for k in range(7):
        at = frame(1680 + 24 + k * 30)
        for j, m in enumerate([SCALE[k % 5] + 12, SCALE[(k + 2) % 7] + 12]):
            mix.add(at + j * 0.06, pluck(m, 1.0, bright=2.5) * 0.35, pan=(-0.6, 0.6)[j], send=0.7)
    # The build: a tom for each twist of the squares, a riser, the countdown.
    twists = [250 + k * 30 for k in range(4)] + [370 + k * 15 for k in range(4)] + [430 + k * 7.5 for k in range(8)]
    for i, at in enumerate(twists):
        mix.add(frame(1680 + at), tom(45 + min(i, 12)), send=0.2)
        mix.add(frame(1680 + at), snare() * (0.3 + 0.5 * i / len(twists)), send=0.2)
    mix.add(bar(16), riser(BAR * 2), send=0.3)
    for k in range(4):
        mix.add(frame(2040 + k * 30), impact(0.25 + 0.1 * k), send=0.2)
        mix.add(frame(2040 + k * 30), stab(CHORDS[0]) * 1.5, send=0.4)

    # --- Finale.
    mix.add(bar(18), impact(1.3), send=0.6)
    mix.add(bar(18), sparkle(2.5) * 0.8, send=0.6)
    mix.add(frame(2160 + 6), whoosh(0.5) * 0.4)
    for i, (f, m) in enumerate([(42, 74), (48, 77), (54, 81)]):
        mix.add(frame(2160 + f), pop(m), pan=(-0.3, 0, 0.3)[i], send=0.4)
    for i in range(32):
        mix.add(frame(2160 + 84 + i * 1.5), tick() * 0.45, pan=0.25)
    for b in (19, 20):
        mix.add(bar(b), swell(0.5) * 0.4)

    # --- The end: everything into the point, the point gone.
    mix.add(bar(21), impact(0.9), send=0.7)
    for i, (beat, m) in enumerate([(0, 74), (1, 77), (2, 81), (3, 86)]):
        mix.add(bar(21) + beat * BEAT * 0.5, pluck(m, 2.5, bright=3.0) * 0.5, pan=(-0.3, 0.3)[i % 2], send=0.7)
    mix.add(frame(2160 + 360 + 10), whoosh(0.9, rising=False) * 0.5)
    mix.add(frame(2160 + 412), pop(62))
    mix.add(frame(2160 + 440), pop(86) * 0.8, send=0.6)

    # The kick ducks what holds notes.
    t = np.arange(N) / SR
    duck = np.ones(N)
    for b in beat_bars:
        for beat in range(4):
            at = bar(b) + beat * BEAT
            i = int(at * SR)
            span = t[i : i + int(BEAT * SR)] - at
            duck[i : i + len(span)] = 1 - 0.6 * np.exp(-span / 0.12)
    out = mix.dry + mix.ducked * duck[:, None]
    out += reverb(mix.send) * 0.35
    out *= np.clip((LENGTH - t) / 1.5, 0, 1)[:, None]
    out = np.tanh(out * 1.1)
    out *= 0.9 / np.abs(out).max()
    wavfile.write(path, SR, (out * 32767).astype(np.int16))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/music.wav")
