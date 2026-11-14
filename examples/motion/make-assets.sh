#!/bin/sh
# Makes what this example uses:
#   assets/music.wav  the music, made by music.py (Python 3 with NumPy and SciPy)
set -e
cd "$(dirname "$0")"
mkdir -p assets
python3 music.py assets/music.wav
