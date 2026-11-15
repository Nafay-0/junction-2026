# The AimoPilot film

A marketing film of just under two minutes, made with [Remotion](https://www.remotion.dev) (React rendered to video).
It stands apart from the web app in `web/`: its own `package.json`, never part of the app's build.

```bash
cd video
npm install
npm run dev                 # Remotion Studio: scrub the film, edit and see it change
npx remotion render Film out/aimopilot-film.mp4 --codec=h264 --crf=15 --jpeg-quality=96 --concurrency=4
```

## How it is put together

- `src/Film.tsx`: the nine scenes in order, the camera move into each, the narration, the music and two sounds.
- `src/camera.tsx`: the camera rig. The film is one world drawn once behind every scene (`World`, with parallax
  layers); scenes are joined by camera moves over it: a pan (beside, below, above, with a floor to tilt through) or a
  nested zoom that swaps two scenes while the object they share is under the camera. The opening and title are cuts.
- `src/scenes/`: one file per scene. The product's widgets (the conversation on its line, the sign-off slab, the
  approver's phone, the dish card) are rebuilt in `src/ui.tsx` from the product's own markup and tokens
  (`web/src/app/globals.css`), so they stay sharp at any zoom. Wide shots of the catalogue and the operations portal
  are real captures (`public/shots/`, copied from `web/public/landing/`).
- Every figure and every product sentence comes from the repository: the flow's words from
  `web/src/app/_landing2/reel-thread.json`, the search figures from `web/src/app/_landing/search-eval.json`, the
  attempts on the gate from `web/src/server/show/recordings/attacks.json`, the rules from `web/src/core/policy.ts`,
  the Aiven services from `infra/aiven.md`.

## The narration drives the timing

- `src/script.json`: what is said, scene by scene.
- `node scripts/vo.mjs`: records each scene with ElevenLabs (model `eleven_v4_turbo`, voice Lily, stability 0.35, style 0.6) through the
  endpoint that returns the time of every character. It keeps the take as recorded in `public/vo/raw/`, writes the
  film's clip to `public/vo/` (ten per cent faster, pitch kept, levelled) and the word times to `src/vo.json`.
  `node scripts/vo.mjs gate` re-records one scene; `node scripts/vo.mjs --post` rebuilds from the raw takes.
- `src/vo.ts`: a scene lasts its narration plus a lead-in and a tail; `cue("flow", "One passkey")` is the frame
  those words are spoken on. Scenes place their moments with `cue()`, so a re-recorded line moves its picture with
  it, and a line that no longer contains the phrase fails the build instead of drifting.
- `src/extra.json`: `into` is the length of the move (or cut) into each scene; `min` the least each scene holds after
  its last word. `node scripts/holds.mjs` solves `extra` from them: the middle of every cut on a beat of the music
  (100 beats a minute, 18 frames a beat), of every camera move on a beat or half beat, and the film ends with the
  track (3541 frames).
- `node scripts/music.mjs bed 1 2 3` makes music candidates of the film's exact length (ElevenLabs Music,
  instrumental); `node scripts/beat.mjs <file>` measures a candidate's tempo, loudness shape and ending.
  `public/music/bed.mp3` is the one the film uses. `node scripts/music.mjs sfx` makes the two small sounds.
- `node scripts/captions.mjs > ../web/public/landing/film.vtt` writes the captions from the same word times.

The key `ELEVENLABS_API_KEY` is read from the git-ignored `web/.env.local`; nothing else needs it, and the committed
clips render without it.

## After rendering

```bash
ffmpeg -i out/aimopilot-film-raw.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 256k out/aimopilot-film.mp4
```

brings the whole mix to about -16 LUFS for the web. The landing page plays `web/public/landing/film.mp4` with
`film-poster.webp` and `film.vtt` beside it.

## The ten-minute demo (`Demo` composition)

A separate composition beside the film, built from real screen recordings of the product; it shares only the theme.

- `src/demo/script.json`: the narration, chapter by chapter (one clip per paragraph). `src/demo/voice.json`: the
  voice and its settings in one place (Patrick, `eleven_v4_turbo`, stability 0.35, style 0.6, tempo 1.0); change
  `voice` and run `node scripts/demo-vo.mjs` to re-record every chapter with another voice. `seeds` re-takes one part.
- `node scripts/demo-vo.mjs [c02 | c02-3 ...]` records into `public/demo-vo/` and writes `src/demo/vo.json` (word
  times); `node scripts/vo-check.mjs public/demo-vo/<part>.mp3` transcribes a take back.
- `public/demo-clips` is a link to the capture session's clips folder (not in git); `node scripts/demo-clips.mjs`
  lists them with their events into `src/demo/clips.json`. `public/demo-film.mp4` is a copy of the finished film,
  used silently for the gate, search and Aiven illustrations (not in git).
- `src/demo/timeline.ts`: the timeline is the narration plus `src/demo/edit.json` (lead, gap, tail, pads, end card).
  `src/demo/edl.ts`: per chapter, the shots and callouts, placed on the narrator's words with `cue(part, phrase)`;
  a shot's `sync` anchors put a clip's event on a spoken word, playing between anchors at 0.9 to 1.5 times, holding a
  frame when the clip runs short and cutting when it runs long. A clip that has not arrived renders as a placeholder.
- `node scripts/demo-music.mjs 600 <name>` makes a bed with ElevenLabs Music; `public/demo-music/bed-loop.mp3` is
  the one used (its body looped with crossfades), ducked under the voice in `src/demo/Demo.tsx`.

```bash
npx remotion render Demo out/demo-raw.mp4 --codec=h264 --crf=17 --jpeg-quality=92 --concurrency=4
scripts/demo-finish.sh out/demo-raw.mp4 <delivery dir>   # -16 LUFS, the small copy, the contact sheet, captions, script
```
