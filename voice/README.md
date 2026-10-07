# 9th Fleet Voice: Gate A spike

A small Windows app that puts one member on two radio nets, each with its own push-to-talk
key or stick button and its own ear. It exists to answer one question before anything else is
built on it: does push-to-talk work reliably while the game has focus?

It is a test tool, not the product. There is no sign-in, no event list and no installer.

## What it does

- Joins one LiveKit room with a pasted join code.
- Two nets. Each has a talk key (keyboard or mouse side button) and a talk stick button.
- Push-to-talk only. Keys work while another program, such as the game, has focus.
- Net 1 plays in the left ear and Net 2 in the right, each with its own volume.
- Shows who is transmitting on which net.
- Keeps a test record: presses, releases, timings and every transmission heard.

## How it works

- **One room per event, one connection per member.** That keeps LiveKit minutes at one per
  person per minute.
- **One audio track per net.** The microphone is opened once and cloned into a track for each
  net. Every track is published muted. Holding a net's key unmutes that net's track and nothing
  else, so there is nothing to send before speaking and no delay when changing nets.
- **Listening is opt-in per net.** The app subscribes only to tracks named for a net it
  monitors, so an unmonitored net is never delivered to that PC. Each received track goes
  through its own pan and volume.
- **Keys** come from a global keyboard and mouse hook
  ([uiohook-napi](https://github.com/SnosMe/uiohook-napi)) in the main process. The window is
  told only "net pressed" and "net released". Other keystrokes are never logged, stored or sent.
- **Stick buttons** are read through the Gamepad API every 10 ms. This is the first candidate
  method. Gate A decides whether it survives the game holding focus.
- **One transmission at a time.** A press on the second net while the first is transmitting is
  refused with a low double tone.
- **Safety nets.** A transmission is cut after 60 seconds, on screen lock, on link loss and
  when a stick is unplugged, in case a release never arrives.

## Run it from source

You need Windows 10 or 11 and [Node.js](https://nodejs.org) 22 or newer.

```
cd voice
npm install
npm start
```

`npm start -- --dev` keeps the menu, which gives you the developer tools.

## Make join codes

A join code is the server address and a short-lived token in one line. Testers paste it once.

1. Create a free project at [LiveKit Cloud](https://cloud.livekit.io).
2. Copy `.env.example` to `.env` and fill in the project URL, API key and API secret.
3. Make one code per person:

```
npm run token -- Tom Alex Sam
npm run token -- --room gate-a --hours 6 Tom Alex Sam
```

The secret stays on your PC. A join code only lets its holder into that one room until it expires.

## Give it to testers

```
npm run dist
```

This writes `release/9thFleetVoice-0.1.0.exe`, a single file that runs without installing.
Every push to `main` also builds it on GitHub: open the latest run under **Actions** and
download the `9thFleetVoice-windows` artifact.

The file is not code-signed, so Windows shows "Windows protected your PC" the first time.
Testers choose **More info**, then **Run anyway**.

## Use it

1. For each net press **Set** beside *Talk key*, then press the key. Do the same for
   *Talk stick button*. Choose keys the game does not use: the game still receives them.
2. Hold a key before connecting. The net shows `KEY HELD, NOT CONNECTED`. This checks keys
   and sticks with the game in focus before anyone else is involved.
3. Paste the join code, pick the microphone and press **Connect**.
4. Hold a talk key. A short tone means the microphone is live. Speak, then release.

If keys work on the desktop but not in the game, the game is probably running as
administrator. Close the app and start it with **Run as administrator**.

## Tests

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Types across the app and tests |
| `npm test` | The push-to-talk rules, routing and join codes, as unit tests |
| `npm run e2e` | Two real copies of the app against a local LiveKit server |

The end-to-end test presses real operating-system keys, so the global hook is exercised, and
measures what reaches each ear on the receiving side. It covers capture of binds, both nets in
the correct ear, refusal of a second net, monitor and ear controls, 50 presses with 50 clean
releases, recovery after the server is restarted, and stick push-to-talk through a stand-in
for the Gamepad API. It needs a `livekit-server` binary (set `LIVEKIT_SERVER` to its path),
Python 3, and on Linux `python-xlib` and a display (`xvfb-run -a npm run e2e`).

GitHub runs all three on every push, on Linux and on Windows, then builds the Windows file and
checks that the packaged copy starts and loads its key hook. See
[`.github/workflows/voice.yml`](../.github/workflows/voice.yml).

## What is proven and what is not

| Question | State |
| --- | --- |
| Global key press and release reach the app | Proven by the end-to-end test |
| One microphone, two keys, two nets, correct ear | Proven by the end-to-end test |
| Release always closes the microphone | 50 of 50 in the end-to-end test, with a fake microphone |
| The app recovers from a lost link by itself | Proven by the end-to-end test |
| Keys work while Star Citizen has focus, with anti-cheat running | **Not tested. Gate A.** |
| Stick buttons are seen while the game has focus | **Not tested. Gate A.** |
| It works when the game is played through a streaming client | **Not tested. Gate A.** |
| Voice quality and delay with real microphones over the internet | **Not tested. Gate A.** |

The Gate A script is in [`docs/gate-a-test.md`](../docs/gate-a-test.md).

## Known limits of the spike

- Stick buttons numbered above 32 are not visible to the Gamepad API. Hat switches and axes
  cannot be bound.
- The net rules are enforced by the app, not the server. Anyone holding a join code can
  subscribe to either net.
- The microphone is chosen before connecting. To change it, disconnect and reconnect.
- Join codes are made by hand. In the product the platform issues them from event slots.
- No automatic update, no radio check playback, no code signing.

## Source layout

```
src/shared/     Pure logic: push-to-talk rules, routing, binds, message types
src/main/       Electron main process: window, global key hook, preload bridge
src/renderer/   The window: LiveKit session, stick polling, interface, test record
scripts/        Join code generator
test/           Unit tests
e2e/            End-to-end test and its key sender
```
