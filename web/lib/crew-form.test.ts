import assert from "node:assert/strict";
import { test } from "node:test";
import { readCrew } from "./crew-form";

const role = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const send = (payload: unknown) => readCrew(JSON.stringify(payload));

test("a crew is read in order, tidied, with its references checked", () => {
  const read = send({
    groups: [
      { key: "g1", id: null, name: "  Bridge " },
      { key: "g2", id: "33333333-3333-4333-8333-333333333333", name: "Gunnery" },
    ],
    stations: [
      { key: "s1", id: null, name: "Helm", roleId: role, count: 1, minimum: 1, groupKey: "g1", brief: " Flies  the ship. ", standInKey: "s2" },
      { key: "s2", id: null, name: "", roleId: other, count: 7, minimum: 4, groupKey: "", brief: "", standInKey: "" },
      { key: "s3", id: null, name: "Remote weapons operator", roleId: other, count: 2, minimum: 0, groupKey: "g2", brief: "", standInKey: "" },
    ],
  });
  assert.ok("crew" in read);
  assert.deepEqual(
    read.crew.groups.map((group) => [group.key, group.id, group.name, group.sortOrder]),
    [
      ["g1", null, "Bridge", 1],
      ["g2", "33333333-3333-4333-8333-333333333333", "Gunnery", 2],
    ],
  );
  assert.deepEqual(
    read.crew.stations.map((station) => [station.name, station.count, station.minimum, station.groupKey, station.brief, station.standInKey, station.sortOrder]),
    [
      ["Helm", 1, 1, "g1", "Flies the ship.", "s2", 1],
      ["", 7, 4, null, "", null, 2],
      ["Remote weapons operator", 2, 0, "g2", "", null, 3],
    ],
  );
});

test("what is wrong with a crew is said plainly", () => {
  const problem = (payload: unknown) => {
    const read = send(payload);
    assert.ok("problem" in read, "expected a problem");
    return read.problem;
  };
  assert.match((readCrew("not json") as { problem: string }).problem, /could not be read/);
  assert.match(problem({ groups: [{ key: "g1", id: null, name: "" }], stations: [] }), /Department 1 needs a name/);
  assert.match(problem({ groups: [{ key: "g1", id: null, name: "Bridge" }, { key: "g2", id: null, name: "bridge" }], stations: [] }), /Two departments are called/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "", roleId: "nope", count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" }] }), /Station 1 needs a role/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "", roleId: role, count: 0, minimum: 0, groupKey: "", brief: "", standInKey: "" }] }), /whole number of seats from 1 to 99/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "Helm", roleId: role, count: 1.5, minimum: 0, groupKey: "", brief: "", standInKey: "" }] }), /Helm needs a whole number of seats/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "", roleId: role, count: 2, minimum: 3, groupKey: "", brief: "", standInKey: "" }] }), /seats to sail are a whole number from 0 up to its seats/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "", roleId: role, count: 1, minimum: 0, groupKey: "g9", brief: "", standInKey: "" }] }), /could not be read/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "Helm", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "s1" }] }), /Helm cannot stand in for itself/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "s9" }] }), /could not be read/);
  assert.match(
    problem({
      groups: [],
      stations: [
        { key: "s1", id: null, name: "", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" },
        { key: "s2", id: null, name: "", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" },
      ],
    }),
    /Two stations share the role and the name of the role/,
  );
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "x".repeat(61), roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" }] }), /under 60 plain characters/);
  assert.match(problem({ groups: [], stations: [{ key: "s1", id: null, name: "Helm\u200b", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" }] }), /plain characters/);
  assert.match(problem({ groups: Array.from({ length: 31 }, (_, i) => ({ key: `g${i}`, id: null, name: `Group ${i}` })), stations: [] }), /at most 30 departments/);
  // The same id twice would make one row stand for two.
  const twice = "44444444-4444-4444-8444-444444444444";
  assert.match(
    problem({
      groups: [],
      stations: [
        { key: "s1", id: twice, name: "A", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" },
        { key: "s2", id: twice, name: "B", roleId: role, count: 1, minimum: 0, groupKey: "", brief: "", standInKey: "" },
      ],
    }),
    /could not be read/,
  );
});
