import assert from "node:assert/strict";
import { test } from "node:test";
import { boardAddress, boardRows, narrowed, narrowingFrom, stateWords, type BoardHull, type BoardModel } from "./ships-board";

const escort = { id: "r1", slug: "escort", name: "Escort", primary: true };
const logistics = { id: "r2", slug: "logistics", name: "Logistics", primary: false };
const gladius: BoardModel = { id: "m1", slug: "gladius", name: "Gladius", maker: "Aegis", kind: "fighter", roles: [escort] };
const cutlass: BoardModel = { id: "m2", slug: "cutlass-black", name: "Cutlass Black", maker: "Drake", kind: "dropship", roles: [{ ...logistics, primary: true }] };
const hull = (model: BoardModel, owner: string, more: Partial<BoardHull> = {}): BoardHull => ({ model, owner, ownerId: owner === "The fleet" ? null : owner, ready: true, inClaim: false, ...more });

test("the board sums the register by model, counting seats aboard what is ready and naming each owner once, the fleet first", () => {
  const rows = boardRows(
    [hull(gladius, "Reyes"), hull(gladius, "Ortega", { ready: false }), hull(gladius, "Reyes", { ready: false, inClaim: true }), hull(cutlass, "Ortega"), hull(cutlass, "The fleet")],
    (id) => (id === "m1" ? 1 : 3),
  );
  assert.deepEqual(
    rows.map((row) => [row.model.slug, row.hulls, row.ready, row.inClaim, row.seats, row.seatsReady, row.owners]),
    [
      ["gladius", 3, 1, 1, 1, 1, ["Reyes", "Ortega"]],
      ["cutlass-black", 2, 2, 0, 3, 6, ["The fleet", "Ortega"]],
    ],
  );
  assert.equal(stateWords(rows[0]), "1 ready, 1 in claim, 1 not ready");
  assert.equal(stateWords(rows[1]), "2 ready");
  assert.equal(stateWords({ hulls: 2, ready: 0, inClaim: 0 }), "2 not ready");
});

test("the address narrows by kind, by role and to what is ready, and ignores what it cannot read", () => {
  assert.deepEqual(narrowingFrom({}), { kind: null, role: null, ready: false });
  assert.deepEqual(narrowingFrom({ kind: "fighter", role: "escort", ready: "1" }), { kind: "fighter", role: "escort", ready: true });
  assert.deepEqual(narrowingFrom({ kind: ["fighter", "bomber"], role: "Not A Slug", ready: "yes" }), { kind: null, role: null, ready: false });
  const rows = boardRows([hull(gladius, "Reyes", { ready: false }), hull(cutlass, "Ortega")], () => 1);
  assert.deepEqual(narrowed(rows, { kind: "fighter", role: null, ready: false }).map((row) => row.model.slug), ["gladius"]);
  assert.deepEqual(narrowed(rows, { kind: null, role: "logistics", ready: false }).map((row) => row.model.slug), ["cutlass-black"]);
  assert.deepEqual(narrowed(rows, { kind: null, role: null, ready: true }).map((row) => row.model.slug), ["cutlass-black"]);
  assert.deepEqual(narrowed(rows, { kind: "fighter", role: null, ready: true }), []);
  assert.equal(boardAddress("/ships", { kind: null, role: null, ready: false }), "/ships");
  assert.equal(boardAddress("/ships", { kind: "fighter", role: "escort", ready: true }), "/ships?kind=fighter&role=escort&ready=1");
});
