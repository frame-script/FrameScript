# Pictures, videos and sound

## Pictures and videos

```tsx
<Clip label="photo" duration={seconds(3)}>
  <img src="assets/photo.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
</Clip>
<Clip label="interview">
  <Video src="assets/interview.mp4" trimStart={12} trimEnd={40} style={{ width: "100%", height: "100%" }} />
</Clip>
```

Paths are relative to the project. `<Video>` plays from the start of its clip, and the clip lasts
as long as the video unless it is given a duration; `playbackRate` changes its speed. Which frame
shows is a function of the frame, like everything else. Videos are decoded with FFmpeg 9 (see
[installing](installing.md)), found at run time, on a thread per video, into a cache around where the playhead is:
playing goes on from frames decoded ahead, scrubbing back over them costs nothing, and the preview
shows the closest frame there is at once and the right one as soon as it is decoded. The cache
outlives reloads. `examples/media` shows both (`./make-assets.sh` makes its files with `ffmpeg`).

## Sound

```tsx
<Timeline>
  <Audio src="assets/music.m4a" volume={0.6} fadeIn={1} fadeOut={2} />
  <Clip label="interview">
    <Video src="assets/interview.mp4" volume={(frame) => (frame < 30 ? frame / 30 : 1)} />
  </Clip>
</Timeline>
```

`<Audio>` plays from the start of its clip (or of the project) and takes `trimStart`, `trimEnd`
and `playbackRate` as `<Video>` does; a `<Video>` plays its own sound unless it is `muted`.
`volume` is a number, or a function of the frame of the clip, which is called for every frame
once when the project loads (it can't follow signals); `fadeIn` / `fadeOut` are in seconds.
Sound isn't made frame by frame: the engine mixes it from where each piece is. In the studio the
sound is the clock while playing, so the picture keeps to what is heard, and moving the playhead
by hand lets a moment of it be heard. It goes out through ALSA on Linux (PipeWire and PulseAudio
take that in), WASAPI on Windows and Audio Queue Services on macOS; `ANTIWEBUI_AUDIO_DEVICE=none`
turns it off.

## Lip sync

```tsx
<Sequence>
  <Clip label="Aoi"><Audio src="voice/001.wav" /></Clip>
  <Clip label="Kou"><Audio src="voice/002.wav" /></Clip>
  <Clip label="Aoi"><Audio src="voice/003.wav" /></Clip>
</Sequence>
<LipSync clip="Aoi" open="aoi/open.png" closed="aoi/closed.png" />
```

`<LipSync>` is a picture that shows `open` while the sound in the clips labeled `clip` (every one
of them, and the clips in them) is louder than `threshold`, 0.1 of the loudest it gets, and
`closed` otherwise; without `clip`, it follows the clip it is in. What it follows is the time in
the file, so trimming and `playbackRate` count, but `volume` doesn't, except that what is silenced
says nothing. `useVoiceLevel(clip)` is how loud that is at the frame, from 0 to 1, for a mouth
of anything else; `audioLevels(src)` is how loud a file is every hundredth of a second, read once
in the engine (a few milliseconds for a line) and handed over as a `Float32Array`.
`examples/lipsync` has two characters talking.
