import { DedupEngine } from './dedup-engine.service';

/**
 * Tests for the message dedup key.
 *
 * This engine sits in front of every message on the bus, so a too-broad key
 * silently drops real messages. That is exactly what happened: the key preferred
 * the patient id, so one escalation addressed to two nurses collided with itself
 * and only reached the first of them.
 */
describe('DedupEngine', () => {
  const base = {
    topic: 'openrx.messages.clinic',
    type: 'message',
    source: { userId: 1 },
  };

  const event = (payload: Record<string, any>) => ({ ...base, payload });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-27T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('blocks the identical message to the same recipient twice', () => {
    const engine = new DedupEngine();
    const e = event({ pid: 7, recipientId: 3, body: 'Waited 55 min' });
    expect(engine.isDuplicate(e)).toBe(false);
    expect(engine.isDuplicate(e)).toBe(true);
  });

  it('lets the same message reach a second, different recipient', () => {
    const engine = new DedupEngine();
    // One page, two nurses: the assigned nurse and the nurse in charge.
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 3, body: 'Waited 55 min' }))).toBe(false);
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 12, body: 'Waited 55 min' }))).toBe(false);
  });

  it('still blocks the same message to the same recipient when the patient is absent', () => {
    const engine = new DedupEngine();
    expect(engine.isDuplicate(event({ recipientId: 3, body: 'Waited 55 min' }))).toBe(false);
    expect(engine.isDuplicate(event({ recipientId: 3, body: 'Waited 55 min' }))).toBe(true);
  });

  it('keeps per-patient dedup for a broadcast with no recipient', () => {
    const engine = new DedupEngine();
    expect(engine.isDuplicate(event({ pid: 7, body: 'Lab result ready' }))).toBe(false);
    expect(engine.isDuplicate(event({ pid: 7, body: 'Lab result ready' }))).toBe(true);
    // A different patient is a different message.
    expect(engine.isDuplicate(event({ pid: 8, body: 'Lab result ready' }))).toBe(false);
  });

  it('lets different content through to the same recipient', () => {
    const engine = new DedupEngine();
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 3, body: 'Waited 55 min' }))).toBe(false);
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 3, body: 'Reassessment due' }))).toBe(false);
  });

  it('keeps two different patients apart when the body looks identical', () => {
    // A real case: two patients with the same complaint and the same waiting
    // time produce the same body, and the patient's name is only in the title.
    // The patient must therefore be part of the key in its own right.
    const engine = new DedupEngine();
    const sameComplaint = { recipientId: 3, body: 'Waited 55 min against a 10 min target' };
    expect(engine.isDuplicate(event({ ...sameComplaint, pid: 7 }))).toBe(false);
    expect(engine.isDuplicate(event({ ...sameComplaint, pid: 8 }))).toBe(false);
    // …while the same patient repeating it is still a duplicate.
    expect(engine.isDuplicate(event({ ...sameComplaint, pid: 7 }))).toBe(true);
  });

  it('allows the same message again once the window has passed', () => {
    const engine = new DedupEngine();
    const e = event({ pid: 7, recipientId: 3, body: 'Waited 55 min' });
    expect(engine.isDuplicate(e)).toBe(false);
    jest.setSystemTime(new Date('2026-09-27T12:04:59Z'));
    expect(engine.isDuplicate(e)).toBe(true);
    jest.setSystemTime(new Date('2026-09-27T12:05:01Z'));
    expect(engine.isDuplicate(e)).toBe(false);
  });

  it('treats a title-only message as distinct by its title', () => {
    const engine = new DedupEngine();
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 3, title: 'A' }))).toBe(false);
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 3, title: 'B' }))).toBe(false);
    expect(engine.isDuplicate(event({ pid: 7, recipientId: 3, title: 'A' }))).toBe(true);
  });
});
