import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_NETS, parseJoinCode, PttArbiter, routeFor, summarise, type NetConfig } from '../src/shared/nets';

describe('PttArbiter', () => {
  it('starts on press and stops on release', () => {
    const arbiter = new PttArbiter();
    assert.deepEqual(arbiter.press('net1', 'key'), { type: 'start', netId: 'net1' });
    assert.equal(arbiter.activeNetId, 'net1');
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'stop', netId: 'net1' });
    assert.equal(arbiter.activeNetId, null);
  });

  it('ignores key auto-repeat', () => {
    const arbiter = new PttArbiter();
    arbiter.press('net1', 'key');
    assert.deepEqual(arbiter.press('net1', 'key'), { type: 'none' });
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'stop', netId: 'net1' });
  });

  it('ignores a release that had no press', () => {
    const arbiter = new PttArbiter();
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'none' });
  });

  it('blocks the second net while the first transmits', () => {
    const arbiter = new PttArbiter();
    arbiter.press('net1', 'key');
    assert.deepEqual(arbiter.press('net2', 'key'), { type: 'blocked', netId: 'net2', activeNetId: 'net1' });
    assert.equal(arbiter.activeNetId, 'net1');
  });

  it('does not hand over to a blocked net when the first is released', () => {
    const arbiter = new PttArbiter();
    arbiter.press('net1', 'key');
    arbiter.press('net2', 'key');
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'stop', netId: 'net1' });
    assert.equal(arbiter.activeNetId, null);
    // Still held from before: nothing happens until it is released and pressed again.
    assert.deepEqual(arbiter.press('net2', 'key'), { type: 'none' });
    assert.deepEqual(arbiter.release('net2', 'key'), { type: 'none' });
    assert.deepEqual(arbiter.press('net2', 'key'), { type: 'start', netId: 'net2' });
  });

  it('keeps transmitting until both the key and the stick button are released', () => {
    const arbiter = new PttArbiter();
    assert.deepEqual(arbiter.press('net1', 'key'), { type: 'start', netId: 'net1' });
    assert.deepEqual(arbiter.press('net1', 'pad'), { type: 'none' });
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'none' });
    assert.equal(arbiter.activeNetId, 'net1');
    assert.deepEqual(arbiter.release('net1', 'pad'), { type: 'stop', netId: 'net1' });
  });

  it('does not confuse nets whose ids share a prefix', () => {
    const arbiter = new PttArbiter();
    arbiter.press('net1', 'key');
    arbiter.press('net10', 'key');
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'stop', netId: 'net1' });
  });

  it('reports what is held', () => {
    const arbiter = new PttArbiter();
    assert.equal(arbiter.holds('net1', 'key'), false);
    arbiter.press('net1', 'key');
    assert.equal(arbiter.holds('net1', 'key'), true);
    assert.equal(arbiter.holds('net1', 'pad'), false);
  });

  it('releaseAll stops the transmission and forgets every held input', () => {
    const arbiter = new PttArbiter();
    arbiter.press('net1', 'key');
    arbiter.press('net2', 'pad');
    assert.deepEqual(arbiter.releaseAll(), { type: 'stop', netId: 'net1' });
    assert.deepEqual(arbiter.releaseAll(), { type: 'none' });
    // The late physical release is ignored, and a fresh press works.
    assert.deepEqual(arbiter.release('net1', 'key'), { type: 'none' });
    assert.deepEqual(arbiter.press('net2', 'pad'), { type: 'start', netId: 'net2' });
  });
});

describe('routeFor', () => {
  const net: NetConfig = { id: 'net1', name: 'Net 1', ear: 'left', volume: 0.5, monitor: true };

  it('puts each default net in its own ear', () => {
    assert.deepEqual(routeFor(DEFAULT_NETS[0]), { gain: 1, pan: -1 });
    assert.deepEqual(routeFor(DEFAULT_NETS[1]), { gain: 1, pan: 1 });
  });

  it('uses the net volume and ear', () => {
    assert.deepEqual(routeFor(net), { gain: 0.5, pan: -1 });
    assert.deepEqual(routeFor({ ...net, ear: 'both' }), { gain: 0.5, pan: 0 });
  });

  it('is silent for an unmonitored or unknown net', () => {
    assert.equal(routeFor({ ...net, monitor: false }).gain, 0);
    assert.equal(routeFor(undefined).gain, 0);
  });

  it('clamps a bad volume', () => {
    assert.equal(routeFor({ ...net, volume: 7 }).gain, 1);
    assert.equal(routeFor({ ...net, volume: -1 }).gain, 0);
    assert.equal(routeFor({ ...net, volume: Number.NaN }).gain, 0);
  });
});

describe('summarise', () => {
  it('handles an empty list', () => {
    assert.deepEqual(summarise([]), { count: 0, median: 0, worst: 0 });
  });

  it('finds the median and the worst value', () => {
    assert.deepEqual(summarise([5, 1, 9]), { count: 3, median: 5, worst: 9 });
    assert.deepEqual(summarise([4, 2, 8, 6]), { count: 4, median: 5, worst: 8 });
  });
});

describe('parseJoinCode', () => {
  it('splits the address from the token', () => {
    assert.deepEqual(parseJoinCode('  wss://fleet.livekit.cloud#aaa.bbb.ccc\n'), {
      url: 'wss://fleet.livekit.cloud',
      token: 'aaa.bbb.ccc',
    });
  });

  it('accepts a local server', () => {
    assert.deepEqual(parseJoinCode('ws://localhost:7880#a.b.c'), { url: 'ws://localhost:7880', token: 'a.b.c' });
  });

  it('rejects anything else', () => {
    assert.equal(parseJoinCode(''), null);
    assert.equal(parseJoinCode('aaa.bbb.ccc'), null);
    assert.equal(parseJoinCode('https://fleet.livekit.cloud#aaa.bbb.ccc'), null);
    assert.equal(parseJoinCode('wss://fleet.livekit.cloud#not-a-token'), null);
  });
});
