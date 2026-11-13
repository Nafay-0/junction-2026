#!/bin/sh
# Makes the voice door's fixed evaluation set: twelve spoken requests as 16 kHz mono WAV files, synthesised
# with macOS `say` voices (several accents, Finnish, Swedish) and mixed with generated kitchen noise
# (pink noise, a babble of other voices, clatter) at two levels. Needs macOS `say` and ffmpeg.
# Outputs to web/eval/voice/ with truth.json. Usage: sh web/scripts/eval/make-voice-set.sh
set -e
OUT="$(cd "$(dirname "$0")/../../eval/voice" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

clean() { # name voice text
  say -v "$2" -o "$TMP/$1.aiff" "$3"
  ffmpeg -loglevel error -y -i "$TMP/$1.aiff" -af "adelay=400|400,apad=pad_dur=0.6" -ar 16000 -ac 1 "$TMP/$1.clean.wav"
}

# Kitchen noise bed: pink noise, three voices talking over each other, and pan clatter.
say -v Samantha -o "$TMP/b1.aiff" "Two plates of salmon on table four, and where is the sauce for the risotto, service please"
say -v Daniel -o "$TMP/b2.aiff" "Behind you, hot pan, hot pan. Can someone take the bread out of the oven"
say -v Satu -o "$TMP/b3.aiff" "Lisää perunoita uuniin ja tiskit pois täältä nopeasti kiitos"
ffmpeg -loglevel error -y -i "$TMP/b1.aiff" -i "$TMP/b2.aiff" -i "$TMP/b3.aiff" \
  -f lavfi -i "anoisesrc=color=pink:amplitude=0.25:duration=12:sample_rate=16000" \
  -f lavfi -i "aevalsrc=0.6*sin(2*PI*2200*t)*exp(-30*mod(t\,1.7))*lt(mod(t\,1.7)\,0.15):s=16000:d=12" \
  -filter_complex "[0]aresample=16000,aloop=loop=3:size=200000[a];[1]aresample=16000,adelay=700,aloop=loop=3:size=200000[b];[2]aresample=16000,adelay=1500,aloop=loop=3:size=200000[c];[a][b][c][3][4]amix=inputs=5:normalize=0,atrim=0:12,volume=0.5" \
  -ac 1 -ar 16000 "$TMP/bed.wav"

noisy() { # name level(dB of bed)
  ffmpeg -loglevel error -y -i "$TMP/$1.clean.wav" -i "$TMP/bed.wav" \
    -filter_complex "[1]volume=$2dB[n];[0][n]amix=inputs=2:duration=first:normalize=0" -ar 16000 -ac 1 "$OUT/$1.wav"
}
keep() { cp "$TMP/$1.clean.wav" "$OUT/$1.wav"; }

clean 01-en-gb-1000l Daniel "I need one thousand litres of lactose-free milk by Monday."; keep 01-en-gb-1000l
clean 02-en-in-oat Aman "Can you get us two hundred litres of oat drink for Wednesday?"; keep 02-en-in-oat
clean 03-en-us-fifteen Samantha "Fifteen kilos of butter, please, for Friday."; keep 03-en-us-fifteen
clean 04-en-za-cream-noise Tessa "Fifty litres of cream for tomorrow."; noisy 04-en-za-cream-noise -6
clean 05-fi-maito Satu "Tarvitsen sata litraa laktoositonta maitoa torstaiksi."; keep 05-fi-maito
clean 06-fi-voi-noise Satu "Kaksi laatikkoa voita perjantaiksi."; noisy 06-fi-voi-noise -6
clean 07-sv-gradde Alva "Vi behöver trettio liter grädde till fredag."; keep 07-sv-gradde
clean 08-sv-yoghurt-noise Alva "Tolv kilo yoghurt, tack."; noisy 08-sv-yoghurt-noise -6
clean 09-en-au-last-time Karen "Same milk as last time, but eighty litres."; keep 09-en-au-last-time
clean 10-en-ie-decimal Moira "Two and a half kilos of parmesan for Thursday."; keep 10-en-ie-decimal
clean 11-en-in-eggs-loud Rishi "Three hundred eggs for Saturday."; noisy 11-en-in-eggs-loud 0
clean 12-en-us-cases-loud Samantha "Six cases of semi-skimmed milk."; noisy 12-en-us-cases-loud 0

cat > "$OUT/truth.json" <<'JSON'
{
  "01-en-gb-1000l.wav": { "lang": "en", "accent": "British", "noise": "none", "said": "I need one thousand litres of lactose-free milk by Monday.", "item": "milk", "amount": 1000, "unit": "L", "readBack": true },
  "02-en-in-oat.wav": { "lang": "en", "accent": "Indian", "noise": "none", "said": "Can you get us two hundred litres of oat drink for Wednesday?", "item": "oat", "amount": 200, "unit": "L" },
  "03-en-us-fifteen.wav": { "lang": "en", "accent": "American", "noise": "none", "said": "Fifteen kilos of butter, please, for Friday.", "item": "butter", "amount": 15, "unit": "kg" },
  "04-en-za-cream-noise.wav": { "lang": "en", "accent": "South African", "noise": "kitchen, moderate", "said": "Fifty litres of cream for tomorrow.", "item": "cream", "amount": 50, "unit": "L" },
  "05-fi-maito.wav": { "lang": "fi", "accent": "Finnish", "noise": "none", "said": "Tarvitsen sata litraa laktoositonta maitoa torstaiksi.", "item": "maito", "amount": 100, "unit": "L" },
  "06-fi-voi-noise.wav": { "lang": "fi", "accent": "Finnish", "noise": "kitchen, moderate", "said": "Kaksi laatikkoa voita perjantaiksi.", "item": "voi", "amount": 2, "unit": "pack" },
  "07-sv-gradde.wav": { "lang": "sv", "accent": "Swedish", "noise": "none", "said": "Vi behöver trettio liter grädde till fredag.", "item": "grädde", "amount": 30, "unit": "L" },
  "08-sv-yoghurt-noise.wav": { "lang": "sv", "accent": "Swedish", "noise": "kitchen, moderate", "said": "Tolv kilo yoghurt, tack.", "item": "yoghurt", "amount": 12, "unit": "kg" },
  "09-en-au-last-time.wav": { "lang": "en", "accent": "Australian", "noise": "none", "said": "Same milk as last time, but eighty litres.", "item": "milk", "amount": 80, "unit": "L" },
  "10-en-ie-decimal.wav": { "lang": "en", "accent": "Irish", "noise": "none", "said": "Two and a half kilos of parmesan for Thursday.", "item": "parmesan", "amount": 2.5, "unit": "kg" },
  "11-en-in-eggs-loud.wav": { "lang": "en", "accent": "Indian", "noise": "kitchen, loud (speech and noise equal)", "said": "Three hundred eggs for Saturday.", "item": "egg", "amount": 300, "unit": "pcs" },
  "12-en-us-cases-loud.wav": { "lang": "en", "accent": "American", "noise": "kitchen, loud (speech and noise equal)", "said": "Six cases of semi-skimmed milk.", "item": "milk", "amount": 6, "unit": "pack" }
}
JSON
ls -la "$OUT"
