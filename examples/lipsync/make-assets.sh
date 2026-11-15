#!/bin/sh
# Makes the faces and the voices this example uses; the voices with the ffmpeg command line.
#   aoi-open.svg, aoi-closed.svg, kou-open.svg, kou-closed.svg
#                 a face of each with its mouth open and closed
#   aoi-*.wav, kou-*.wav
#                 hums in syllables at each one's pitch, for lines: a mouth opens on each syllable
set -e
cd "$(dirname "$0")"
mkdir -p assets

closed='<path d="M190 322 Q240 350 290 322" stroke="#1e1b2e" stroke-width="12" fill="none" stroke-linecap="round"/>'
open='<ellipse cx="240" cy="330" rx="46" ry="40" fill="#1e1b2e"/><ellipse cx="240" cy="352" rx="28" ry="14" fill="#e86a7a"/>'
# face NAME COLOR
face() {
  for mouth in open closed; do
    eval "shape=\$$mouth"
    cat > "assets/$1-$mouth.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
  <circle cx="240" cy="240" r="220" fill="$2"/>
  <circle cx="168" cy="205" r="22" fill="#1e1b2e"/>
  <circle cx="312" cy="205" r="22" fill="#1e1b2e"/>
  $shape
</svg>
EOF
  done
}
face aoi "#7dd3fc"
face kou "#fcd34d"

# voice FILE PITCH SYLLABLES-A-SECOND SECONDS: syllables, with a breath every two seconds
voice() {
  ffmpeg -v error -y -f lavfi \
    -i "aevalsrc=0.3*(sin(2*PI*$2*t)+0.5*sin(4*PI*$2*t)+0.25*sin(6*PI*$2*t))*max(0\,sin(PI*$3*t))*lt(mod(t\,2)\,1.6):s=48000:d=$4" \
    "assets/$1.wav"
}
voice aoi-1 260 7 3.2
voice kou-1 150 5.5 2.4
voice aoi-2 260 7 1.6
echo "made $(ls assets | tr '\n' ' ')"
