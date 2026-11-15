#!/bin/zsh
# Finishes a render of the Demo composition for delivery.
#   scripts/demo-finish.sh out/demo-raw.mp4 /path/to/delivery
# Writes aimopilot-demo-10min.mp4 (the mix at -16 LUFS, peaks under -1.5 dBTP, faststart),
# aimopilot-demo-10min-small.mp4 (two-pass, about 55 MB, faststart), aimopilot-demo-10min-sheet.jpg (a frame every 15 s),
# and the captions and script files (scripts/demo-export.mjs).
set -e
raw=$1
dst=$2
here=${0:A:h}
[[ -f $raw && -d $dst ]] || { echo "usage: $0 <raw render> <delivery dir>"; exit 1; }
tmp=$(mktemp -d)

# 1. Loudness: measure, then normalise linearly to -16 LUFS integrated.
stats=$(ffmpeg -hide_banner -nostats -i "$raw" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo $stats | python3 -c 'import json,sys;print(json.load(sys.stdin)["input_i"])')
mtp=$(echo $stats | python3 -c 'import json,sys;print(json.load(sys.stdin)["input_tp"])')
mlra=$(echo $stats | python3 -c 'import json,sys;print(json.load(sys.stdin)["input_lra"])')
mth=$(echo $stats | python3 -c 'import json,sys;print(json.load(sys.stdin)["input_thresh"])')
off=$(echo $stats | python3 -c 'import json,sys;print(json.load(sys.stdin)["target_offset"])')
ffmpeg -y -hide_banner -loglevel error -i "$raw" -c:v copy \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${mi}:measured_TP=${mtp}:measured_LRA=${mlra}:measured_thresh=${mth}:offset=${off}:linear=true,aresample=48000" \
  -c:a aac -b:a 256k -movflags +faststart "$dst/aimopilot-demo-10min.mp4"

# 2. The small copy: two passes at a bitrate that lands near 55 MB.
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$raw")
vk=$(python3 -c "print(int(55*8*1024/$dur - 96))")
( cd $tmp && ffmpeg -y -hide_banner -loglevel error -i "$dst/aimopilot-demo-10min.mp4" -c:v libx264 -preset slow -b:v ${vk}k -pass 1 -an -f null /dev/null \
  && ffmpeg -y -hide_banner -loglevel error -i "$dst/aimopilot-demo-10min.mp4" -c:v libx264 -preset slow -b:v ${vk}k -pass 2 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "$dst/aimopilot-demo-10min-small.mp4" )

# 3. A contact sheet: a frame every 15 seconds.
ffmpeg -y -hide_banner -loglevel error -i "$dst/aimopilot-demo-10min-small.mp4" -vf "fps=1/15,scale=320:-1,tile=8x5" -frames:v 1 "$dst/aimopilot-demo-10min-sheet.jpg"

# 4. Captions and the script.
node "$here/demo-export.mjs" "$dst"

for f in aimopilot-demo-10min.mp4 aimopilot-demo-10min-small.mp4; do
  echo "$f $(ffprobe -v error -show_entries format=duration:format=size -of csv=p=0 "$dst/$f")"
done
ffmpeg -hide_banner -nostats -i "$dst/aimopilot-demo-10min.mp4" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)" | head -2
