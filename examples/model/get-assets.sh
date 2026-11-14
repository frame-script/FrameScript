#!/bin/sh
# Fetches the model this example uses: Fox, from the Khronos glTF sample assets.
#   assets/Fox.glb  a fox with a skin and three animations (Survey, Walk, Run)
#                   by PixelMannen (the model) and tomkranis (the rig and the animations),
#                   CC BY 4.0; see https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
set -e
cd "$(dirname "$0")"
mkdir -p assets
curl -sSfL -o assets/Fox.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb
