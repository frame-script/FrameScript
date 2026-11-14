#!/bin/sh
# Makes what this example uses:
#   assets/music.wav  the music, made by music.py (Python 3 with NumPy and SciPy)
#   assets/Fox.glb    a fox with a skin and animations, from the Khronos glTF sample assets,
#                     by PixelMannen (the model) and tomkranis (the rig and the animations),
#                     CC BY 4.0; see https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
set -e
cd "$(dirname "$0")"
mkdir -p assets
python3 music.py assets/music.wav
[ -f assets/Fox.glb ] || curl -sSfL -o assets/Fox.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb
