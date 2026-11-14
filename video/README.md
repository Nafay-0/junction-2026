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

- `src/Film.tsx`: the nine scenes in order, one transition between them, the narration, the music and two sounds.
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
- `node scripts/vo.mjs`: records each scene with ElevenLabs (model `eleven_v4_turbo`, voice George) through the
  endpoint that returns the time of every character. It keeps the take as recorded in `public/vo/raw/`, writes the
  film's clip to `public/vo/` (ten per cent faster, pitch kept, levelled) and the word times to `src/vo.json`.
  `node scripts/vo.mjs gate` re-records one scene; `node scripts/vo.mjs --post` rebuilds from the raw takes.
- `src/vo.ts`: a scene lasts its narration plus a lead-in and a tail; `cue("flow", "One passkey")` is the frame
  those words are spoken on. Scenes place their moments with `cue()`, so a re-recorded line moves its picture with
  it, and a line that no longer contains the phrase fails the build instead of drifting.
- `src/extra.json`: the frames each scene holds after its last word, chosen so that every cut falls on a beat of the
  music (100 beats a minute is 18 frames a beat) and the film ends with the track.
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
