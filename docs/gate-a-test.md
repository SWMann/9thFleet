# Gate A: voice proven

**Due:** Sunday 8 November 2026.
**Question:** can members talk on two nets by push-to-talk, from a keyboard key and a stick
button, while the game has focus?

**Gate A passes when** every PC transmits on both nets from a keyboard key and from a stick
button with the game in focus, and transmission stops on release in 50 presses out of 50 for
each method.

Three PCs take part: yours and two helpers'. One of the three plays through a streaming client
(GeForce Now or Moonlight). Each PC needs a headset and a stick, throttle or gamepad.

**Changed on 13 October 2026.** There are no helpers yet, so Tom decided that Gate A is settled
on his PC alone: see [Part 2, solo](#part-2-solo-one-pc). What one PC cannot show is carried to
Gate B, due 10 January 2027:

- that it works on other people's PCs, with their sticks, their Windows and their antivirus;
- that it works when the game is played through a streaming client;
- several people talking at once.

The three-PC session below is kept as the script for that.

## Part 1: on your own, before the session

Part 1 needs no helpers and answers the two riskiest questions first. Allow 30 minutes.

1. Get the app: download `9thFleetVoice-windows` from the latest run under **Actions**, or
   run `npm run dist` in `voice/`.
2. Start the app. Under *Input health*, **Key hook** must read `running`.
3. Set a talk key and a talk stick button for each net. Use keys the game does not use.
4. Do not connect. Start Star Citizen and load into a ship or a hangar, not a menu.
5. With the game in focus, hold each of the four inputs for a second, one after another.
6. Switch back to the app and read the log. You want four pairs of lines like these, each
   marked `app in background`:

   ```
   KEY DOWN Net 1 by key (app in background, not connected so nothing is sent)
   KEY UP Net 1
   ```

| Result | Meaning |
| --- | --- |
| All four appear | Both input methods work with the game in focus. Go to Part 2. |
| Keys appear, stick does not | The Gamepad API loses the stick in the background. Note the stick model and the *Stick poll gap* value. The fallback is a native stick reader. |
| Nothing appears | Close the app, start it with **Run as administrator** and repeat. Record which way worked. |
| Stick button cannot be set at all | The button may be numbered above 32. Try a lower button and note the stick model. |

Press **Save…** and keep the file whatever the result.

### Part 1 result: passed on 13 October 2026

Tom ran Part 1 on his own PC. All four inputs were seen with Star Citizen loaded and in focus,
and the app did not need **Run as administrator**. The saved record is
[`records/gate-a-part-1-2026-10-13.txt`](records/gate-a-part-1-2026-10-13.txt).

| | Result |
| --- | --- |
| Keys (Numpad1, Numpad2) | 6 presses, 6 releases, none cut. The shortest press, 45 ms, was caught with its release |
| Stick (buttons 6 and 5) | 6 presses, 6 releases, none cut, including four taps of about 100 ms |
| Stick reading in the background | Not slowed: taps 80 to 120 ms long were each caught with their release |
| Second key | Net 2 was refused while Net 1 was held, as designed |

The record says the app was in the background. It cannot say which program was in front: that
the game was is Tom's word, given the same day.

Part 1 is one PC, with nothing sent. Gate A is still decided by Part 2.

Two things the record showed that the script did not ask about. Neither stops the gate.

- **Two sticks of the same model.** Both report the same name, so the app tells them apart by
  the order Windows lists them: the binds are on "#2". If that order changes after a stick is
  unplugged or the PC is restarted, a bind would move to the other stick. To be checked: close
  the app, unplug both sticks and plug them in again, and see whether the binds still answer to
  the same hand.
- **32 buttons.** The app saw 32 buttons on each stick, which is the most the Gamepad API
  reports. A button numbered above 32 cannot be bound. A native stick reader would lift this.

## Part 2, solo: one PC

**Gate A passes when** Tom's PC transmits on both nets from a keyboard key and from a stick
button with the game in focus, and transmission stops on release in 50 presses out of 50 for
each method, as counted by a second copy of the app listening in the same room.

The second copy runs on the same PC and is the **listener**. It joins under its own name and
has no binds, so it never transmits. The copy with the binds is the **sender**. Both go through
LiveKit Cloud, so the voice still crosses the internet. Allow 45 minutes.

### Join codes

Made on the Mac, in the repository's `voice` folder, with Node.js 22 or newer.

1. Create a free project at [LiveKit Cloud](https://cloud.livekit.io).
2. Copy `.env.example` to `.env` and fill in the project URL, API key and API secret. The
   `.env` file stays on that computer. Never commit it, post it or paste it into a chat.
3. Run `npm ci --ignore-scripts`, then
   `npm run token -- --room gate-a --hours 6 Tom Listener`.

It prints two join codes, each one long line. Take both to the PC privately: a join code lets
its holder into the room until it expires.

### Set up

1. Start the app as usual. This is the sender, and its binds are kept from Part 1. Paste Tom's
   join code, pick the microphone and press **Connect**.
2. Start the listener. In the folder that holds the app, click the address bar, type `cmd` and
   press Enter, then run:

   ```
   9thFleetVoice-0.1.0.exe --user-data-dir=%TEMP%\fleet-listener
   ```

   The new window must show **no binds**. If it shows the sender's binds, stop: the two copies
   are sharing their settings and the test would mean nothing.
3. In the listener paste the Listener join code, pick the microphone and press **Connect**.
   Both windows should show two names under *In the room*.
4. Wear the headset. You will hear yourself a moment late. That is the listener.

### The tests

Run them in order.

| # | Test | Do this | Passes when |
| --- | --- | --- | --- |
| 1 | Radio check | Say "radio check" on Net 1, then on Net 2 | You hear Net 1 in the left ear only and Net 2 in the right ear only |
| 2 | Net separation | In the listener untick **Monitor** on Net 2. Transmit on Net 2 | You hear nothing and the listener's log shows no `RECEIVING`. Tick **Monitor** again |
| 3 | First syllable | Say "one two three" five times on each net, starting to speak on the tone | You hear a complete "one" every time |
| 4 | Game in focus | Load into the game. Transmit on both nets by key and by stick | You hear all four |
| 5 | 50 of 50 | Press **Reset counts** in both windows. With the game in focus make 50 one-second transmissions by key, then 50 by stick, alternating nets and saying the count aloud. Then press **Save…** in both windows before going on | See below |
| 6 | Second key | Hold Net 1, then press Net 2 | A low double tone. Nothing is heard on Net 2 |
| 7 | Recovery | Turn the PC's network off for ten seconds, then on | Both windows show `Reconnecting`, then `Connected`, and a transmission is heard again without either being restarted |

Test 3 is judged from your own voice coming back late, which is harder to hear than someone
else's. The *Key to live* figures in the sender's saved file are the firmer evidence.

**Test 5 passes when all of these hold, in the files saved straight after it:**

- In the sender's *Sent from this PC*, each of the four rows has **Presses** equal to
  **Releases**, the key rows total 50, the stick rows total 50, and **Cut by app** is 0
  everywhere.
- In the listener's *Heard on this PC*, Tom's transmissions total 100, with **Longest** under
  5 seconds.

At the end press **Save…** in both windows again. Keep all four files.

Last, the check left over from Part 1: close both copies, unplug both sticks, plug them in
again, start the app and see whether the stick binds still answer to the same hand.

### Solo record

| | Result |
| --- | --- |
| 1 Radio check | |
| 2 Net separation | |
| 3 First syllable, and *Key to live* | |
| 4 Game in focus: key | |
| 4 Game in focus: stick | |
| 5 Key: presses / releases / cuts | |
| 5 Stick: presses / releases / cuts | |
| 5 Heard by the listener: count / longest | |
| 6 Second key | |
| 7 Recovery | |
| Voice delay, as judged by ear | |
| Sticks keep their binds after being plugged in again | |

**Gate A result, on one PC:** pass / fail. **Date:**

## Part 2 with helpers: the session, moved to Gate B

Allow 60 minutes. Before it starts:

1. Make three join codes: `npm run token -- --room gate-a --hours 6 Tom Helper1 Helper2`.
2. Send each helper the app file and their own join code.
3. Each person sets four binds, picks their microphone and connects. Everyone should see
   three names under *In the room*.
4. Agree a text channel for coordination in case voice fails.

Run the tests in order. Each person presses **Reset counts** before test 5.

| # | Test | Do this | Passes when |
| --- | --- | --- | --- |
| 1 | Radio check | Each person in turn says "radio check" on Net 1, then on Net 2 | Both others hear Net 1 in the left ear only and Net 2 in the right ear only |
| 2 | Net separation | One listener unticks **Monitor** on Net 2. Another person transmits on Net 2 | That listener hears nothing and sees no `RECEIVING`. The third person hears it. Tick **Monitor** again |
| 3 | First syllable | Each person says "one two three" five times on each net, starting to speak on the tone, and alternating nets | Listeners hear a complete "one" every time |
| 4 | Game in focus | Everyone loads into the game. Each person transmits on both nets by key and by stick | All four inputs work on every PC, including the streaming PC |
| 5 | 50 of 50 | With the game in focus each person makes 50 one-second transmissions by key, then 50 by stick, alternating nets, saying the count aloud | See below |
| 6 | Second key | Hold Net 1, then press Net 2 | A low double tone. Nothing is sent on Net 2 |
| 7 | Recovery | One person turns their network off for ten seconds, then on | The app shows `Reconnecting`, then `Connected`, and transmits again without being restarted |

**Test 5 passes for a PC when all of these hold:**

- In *Sent from this PC*, each of the four rows has **Presses** equal to **Releases**, the key
  rows total 50, the stick rows total 50, and **Cut by app** is 0 everywhere.
- On both other PCs, *Heard on this PC* shows that person's transmissions totalling 100, with
  **Longest** under 5 seconds.
- Nobody saw `TRANSMITTING` stay lit after a release.

At the end everyone presses **Save…** and sends you the file.

## Record

| | PC 1 (you) | PC 2 | PC 3 (streaming) |
| --- | --- | --- | --- |
| Name | Tom | | |
| Game runs | Locally | Locally | Through: |
| Stick model | Two VKBSim Gunfighter MCG Ultimate Twist | | |
| Needed Run as administrator | No | | |
| 1 Radio check | | | |
| 2 Net separation | | | |
| 3 First syllable | | | |
| 4 Game in focus: key | | | |
| 4 Game in focus: stick | | | |
| 5 Key: presses / releases / cuts | | | |
| 5 Stick: presses / releases / cuts | | | |
| 5 Heard by others: count / longest | | | |
| 6 Second key | | | |
| 7 Recovery | | | |
| Voice delay, as judged by ear | | | |

**Result with helpers:** pass / fail. **Date:**

## If something fails

| Failure | What it means | Next step |
| --- | --- | --- |
| Test 4 fails for keys on one PC | The hook is blocked for that game session | Retry as administrator. If it still fails, the app needs a different key capture method |
| Test 4 fails for sticks | The Gamepad API is not delivered in the background | Build the native stick reader and rerun tests 4 and 5 |
| Test 4 fails only on the streaming PC | The streaming client takes the input first | Record the client and settings. Decide whether streamed play is supported at launch |
| Test 5 shows a cut or a long transmission | A release was missed | Send the saved files. The log shows which input and when |
| Test 3 clips the first word | Opening the microphone is too slow | Send the *Key to live* figures from the saved files |
| Test 1 has the ears wrong or mixed | Routing fault | Send the saved files |

A failed gate follows the rule agreed in the roadmap: the launch slips by up to four weeks.
Past that, the fleet launches on a stopgap voice server and the app is finished afterwards.
