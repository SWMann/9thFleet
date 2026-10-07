# Gate A: voice proven

**Due:** Sunday 8 November 2026.
**Question:** can members talk on two nets by push-to-talk, from a keyboard key and a stick
button, while the game has focus?

**Gate A passes when** every PC transmits on both nets from a keyboard key and from a stick
button with the game in focus, and transmission stops on release in 50 presses out of 50 for
each method.

Three PCs take part: yours and two helpers'. One of the three plays through a streaming client
(GeForce Now or Moonlight). Each PC needs a headset and a stick, throttle or gamepad.

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

## Part 2: the session

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
| Name | | | |
| Game runs | Locally | Locally | Through: |
| Stick model | | | |
| Needed Run as administrator | | | |
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

**Gate A result:** pass / fail. **Date:**

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
