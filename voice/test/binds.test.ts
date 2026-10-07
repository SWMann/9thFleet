import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keyBindId, padBindId, padLabel, shortPadName } from '../src/shared/binds';

describe('binds', () => {
  it('gives keys and mouse buttons distinct ids', () => {
    assert.equal(keyBindId({ kind: 'key', code: 4, label: '3' }), 'key:4');
    assert.equal(keyBindId({ kind: 'mouse', button: 4, label: 'Mouse button 4' }), 'mouse:4');
  });

  it('tells two identical sticks apart', () => {
    const left = padBindId({ padId: 'VKB Gladiator', ordinal: 0, button: 2 });
    const right = padBindId({ padId: 'VKB Gladiator', ordinal: 1, button: 2 });
    assert.notEqual(left, right);
  });

  it('shortens the device name', () => {
    assert.equal(shortPadName('VKB-Sim Gladiator NXT R (Vendor: 231d Product: 0200)'), 'VKB-Sim Gladiator NXT R');
    assert.equal(shortPadName('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'Xbox 360 Controller (XInput STANDARD GAMEPAD)');
    assert.equal(shortPadName('(Vendor: 231d Product: 0200)'), '(Vendor: 231d Product: 0200)');
  });

  it('numbers buttons from 1 for people', () => {
    assert.equal(padLabel('Stick (Vendor: 1 Product: 2)', 0, 0), 'Stick, button 1');
    assert.equal(padLabel('Stick (Vendor: 1 Product: 2)', 1, 4), 'Stick #2, button 5');
  });
});
