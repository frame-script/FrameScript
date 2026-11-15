# Checking a video

An AI agent can't watch the studio, and a video that looks right in the code often isn't: text runs
off the frame, a box covers another, an animation ends somewhere else, a clip is empty. So an agent
**checks the video itself, by rendering frames and looking at the pictures**, after every change and
before it says the video is done, and tells the person what it looked at and what it saw.

Renders go in `check/` (keep it out of git).

## 1. It loads

```sh
framescript render . --frame 0 --out check/f-0.png
```

An error in the project fails here, with the file and line (exit code 1): read it, fix it, render
again. The first line says how long the video is (`loaded <name> in … ms: 534 frames, 4 clips`):
is that what was meant?

## 2. The frames where things happen

Render the start and end of each clip, the middle and end of each animation, and the last frame,
small, then look at every picture:

```sh
framescript render . --width 640 --frame 0 --frame 45 --frame 90 --out check/f-{}.png
```

One a second (at 60 fps, up to frame 600), in bash or zsh:

```sh
framescript render . --width 480 $(for f in $(seq 0 60 600); do printf -- '--frame %s ' $f; done) --out check/f-{}.png
```

`--width` draws the frame smaller (the layout is the project's, so things are where they will be),
which is quicker and cheaper to look at. Look at the full size (no `--width`) to judge whether text
is sharp and big enough.

## 3. Motion

One frame can't show timing. Render frames close together across a move, every 3 to 5 frames,
and see that it starts, eases and stops where it should, and that nothing jumps:

```sh
framescript render . --width 480 --frame 30 --frame 34 --frame 38 --frame 42 --frame 46 --out check/m-{}.png
```

## What to look for

- Text cut off at the edges of the frame, or running out of its box.
- Things off the frame, or covered by others; what is in front of what.
- Text too small, or too faint against what is behind it, to read.
- A frame that is empty where something should be, or a clip that shows too long or too short.
- An animation that ends somewhere other than meant, or moves at the wrong time.
- Against the sound: mouths (`<LipSync>`), cuts on the beat, captions with their lines.

## 4. The export

After `framescript export . --out out/video.mp4`, check the file too (`ffmpeg` and `ffprobe` are
FFmpeg's; with the FFmpeg that `create-framescript` downloaded, they are in `<home>/ffmpeg/bin`).

```sh
# Its length, its size, and whether it has sound.
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact out/video.mp4

# The whole video in one picture: a frame a second, 16 of them (fps=1/2 for one every 2 seconds).
ffmpeg -v error -i out/video.mp4 -vf "fps=1,scale=320:-1,tile=4x4" -frames:v 1 -y check/sheet.png

# The picture at 12.5 seconds.
ffmpeg -v error -ss 12.5 -i out/video.mp4 -frames:v 1 -y check/at-12.5.png

# Where it is silent for more than a second.
ffmpeg -hide_banner -i out/video.mp4 -vn -af silencedetect=n=-50dB:d=1 -f null - 2>&1 | grep silence_
```

Look at the sheet and the pictures as at step 2. A video without sound has no `audio` stream in
what `ffprobe` says.
