"use client";

import { useActionState } from "react";
import { saveNames, type NamesResult } from "./actions";

const untouched: NamesResult = { ok: false, message: "" };

export function NamesForm({
  characterName,
  rsiHandle,
  nameIsFixed,
}: {
  characterName: string | null;
  rsiHandle: string | null;
  nameIsFixed: boolean;
}) {
  const [result, action, pending] = useActionState(saveNames, untouched);

  return (
    <form action={action} className="fields">
      <div className="field">
        <label htmlFor="character_name">Character name</label>
        <p className="hint" id="character_name_hint">
          {nameIsFixed
            ? "This is fixed now that you have joined. Ask staff if it needs to change."
            : "The name the fleet will call you, such as Ada Vance. You can change it until you join."}
        </p>
        <input
          id="character_name"
          name={nameIsFixed ? undefined : "character_name"}
          type="text"
          defaultValue={characterName ?? ""}
          readOnly={nameIsFixed}
          required={!nameIsFixed}
          minLength={2}
          maxLength={40}
          autoComplete="off"
          aria-describedby="character_name_hint"
        />
      </div>

      <div className="field">
        <label htmlFor="rsi_handle">RSI handle</label>
        <p className="hint" id="rsi_handle_hint">
          Your handle on the Roberts Space Industries website. It is how the fleet finds you in the game.
        </p>
        <input
          id="rsi_handle"
          name="rsi_handle"
          type="text"
          defaultValue={rsiHandle ?? ""}
          required
          minLength={3}
          maxLength={60}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="rsi_handle_hint"
        />
      </div>

      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </button>
        <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
          {result.message}
        </p>
      </div>
    </form>
  );
}
