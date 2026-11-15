# Exporting

The export window in the studio, or `framescript export <project>` (see `--help`), writes the
video with its sound through the system's `ffmpeg` (or `FRAMESCRIPT_FFMPEG`): H.264, H.265 or AV1
in MP4, ProRes 422 HQ in MOV, and H.264 / H.265 on the GPU through VA-API where that works. It
takes a quality (CRF), a speed, a size (50–200% of the project's, made from the frame at the
project's size; more than 100% is enlarged, Catmull-Rom), the frames to write and how many are
drawn at once.

Since a frame is a pure function of its number, the frames are shared out among workers, each with
a V8, a document, a GPU device and an encoder of its own: each goes through a stretch of the frames
in order (its videos decode in order), and one that is done first takes the second half of what
another has left. The pieces are joined as they are, and the sound is mixed from the same plan as
in the preview. Pictures become YUV 4:2:0 (BT.709) on the GPU, so the encoder has nothing to
convert. More workers help when drawing is what takes the time; when the encoder is, they can't.

The options of `framescript export` are in [projects, commands and the studio](project.md#commands).
