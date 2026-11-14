#!/bin/sh
# Makes the pictures, videos and sound this example uses, with the ffmpeg command line.
#   counter.mp4  10 s of 1920x1080 at 60 fps, the number of each frame on it, a key frame every 2 s,
#                and a beep at the start of every second: what is heard and seen should agree
#   bars.mp4     6 s of 1280x720 at 30 fps, moving
#   photo.png    a picture to move over
#   pad.m4a      16 s of a chord, to go under everything
set -e
cd "$(dirname "$0")"
mkdir -p assets
ffmpeg -v error -y -f lavfi -i "testsrc=size=1920x1080:rate=60:duration=10" \
  -f lavfi -i "aevalsrc=0.4*sin(2*PI*880*t)*lt(mod(t\,1)\,0.08):s=48000:d=10" \
  -c:v libx264 -preset veryfast -crf 20 -g 120 -bf 2 -pix_fmt yuv420p -c:a aac -b:a 128k \
  assets/counter.mp4
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -c:v libx264 -preset veryfast -crf 22 -g 60 -pix_fmt yuv420p assets/bars.mp4
ffmpeg -v error -y -f lavfi -i "mandelbrot=size=2400x1350:end_pts=1" -frames:v 1 assets/photo.png
ffmpeg -v error -y -f lavfi \
  -i "aevalsrc=0.07*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.75+0.25*sin(2*PI*0.25*t)):s=44100:d=16" \
  -c:a aac -b:a 128k assets/pad.m4a
echo "made $(ls assets | tr '\n' ' ')"
