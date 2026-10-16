'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RoomClock, SynchronizedPCMPlayer } = require('../../public/sync-player');
const { MockContext } = require('../helpers/audio-mock');

test('horloge : mesure aller-retour et refuse une réponse invalide', () => {
  const clock = new RoomClock(); clock.update(100, 1110, 120);
  assert.equal(clock.offset, 1000); assert.equal(clock.rtt, 20);
  clock.update(100, 9000, 200); assert.equal(clock.offset, 1000);
  clock.update(300, Infinity, 310); assert.equal(clock.offset, 1000);
});
test('deux sorties de latences différentes suivent la même échéance physique', () => {
  const a = new MockContext(), b = new MockContext(); a.currentTime = 10.03; b.currentTime = 20.07;
  const stampA = { contextTime: 10, performanceTime: 3900 }, stampB = { contextTime: 20, performanceTime: 6900 };
  a.getOutputTimestamp = () => stampA; b.getOutputTimestamp = () => stampB;
  const ca = new RoomClock(), cb = new RoomClock(); ca.offset = 1000; cb.offset = -2000;
  const samples = new Float32Array(480).fill(0.2);
  new SynchronizedPCMPlayer(a, {}).pushAt(samples, samples, ca.audioTime(a, 5000));
  new SynchronizedPCMPlayer(b, {}).pushAt(samples, samples, cb.audioTime(b, 5000));
  const physicalA = (a.sources[0].startTime - stampA.contextTime) * 1000 + stampA.performanceTime + ca.offset;
  const physicalB = (b.sources[0].startTime - stampB.contextTime) * 1000 + stampB.performanceTime + cb.offset;
  assert.ok(Math.abs(physicalA - physicalB) < 0.001); assert.ok(Math.abs(physicalA - 5000) < 0.001);
});
test('gigue différente sur deux appareils : 3 minutes sans décalage accumulé', () => {
  const contexts = [new MockContext(), new MockContext()], latencies = [0.015, 0.045];
  const players = contexts.map(c => new SynchronizedPCMPlayer(c, {})), clocks = [new RoomClock(), new RoomClock()];
  clocks.forEach(c => { c.offset = 0; });
  const samples = new Float32Array(480).fill(0.2);
  for (let frame = 0; frame < 18000; frame++) {
    const deadline = 1000 + frame * 10 + 150;
    for (let i = 0; i < 2; i++) {
      const arrival = 1000 + frame * 10 + (frame % (i ? 5 : 7)) * (i ? 3 : 1);
      contexts[i].advance(arrival / 1000);
      contexts[i].getOutputTimestamp = () => ({ contextTime: contexts[i].currentTime - latencies[i], performanceTime: arrival });
      players[i].pushAt(samples, samples, clocks[i].audioTime(contexts[i], deadline));
      const actual = (players[i].previous.start + latencies[i]) * 1000;
      assert.ok(Math.abs(actual - deadline) < 0.02, 'Écart : ' + (actual - deadline));
    }
  }
  for (const player of players) { assert.equal(player.latePackets, 0); assert.equal(player.underruns, 0); }
});
test('paquet trop tardif : jamais rejoué en retard sur un seul appareil', () => {
  const context = new MockContext(); context.currentTime = 5;
  const player = new SynchronizedPCMPlayer(context, {}), samples = new Float32Array(480);
  player.pushAt(samples, samples, 4.9); assert.equal(context.sources.length, 0); assert.equal(player.latePackets, 1);
  player.pushAt(samples, samples, 5.15); assert.equal(context.sources[0].startTime, 5.15);
});

test('alignement manuel de l’hôte : une avance de 60 ms est corrigée sans déplacer les auditeurs', () => {
  const context = new MockContext(); context.currentTime = 10.05;
  context.getOutputTimestamp = () => ({ contextTime:10, performanceTime:1000 });
  const clock = new RoomClock(); clock.offset = 0;
  const listener = clock.audioTime(context, 1200);
  const host = clock.audioTime(context, 1200, 60);
  assert.ok(Math.abs((host-listener)*1000-60)<.001);
  assert.equal(clock.offset,0);
});
