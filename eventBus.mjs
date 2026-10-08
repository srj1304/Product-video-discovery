import { EventEmitter } from 'node:events';
import { db } from '../db/database.mjs';
import { id } from '../utils/id.mjs';
import { nowIso } from '../utils/time.mjs';

export const bus = new EventEmitter();
export function emitSearchEvent(searchId, eventType, payload, jobId = null) {
  const last = db.prepare('SELECT COALESCE(MAX(sequence_no),0) AS n FROM events WHERE search_id=?').get(searchId).n;
  const event = { id: id('evt'), searchId, jobId, eventType, payload, sequenceNo: last + 1, createdAt: nowIso() };
  db.prepare('INSERT INTO events(id,search_id,job_id,event_type,payload_json,sequence_no,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(event.id, searchId, jobId, eventType, JSON.stringify(payload), event.sequenceNo, event.createdAt);
  bus.emit(`search:${searchId}`, event);
  return event;
}
