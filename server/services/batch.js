import { Reel, Topic, SEED_TOPICS } from '../models.js';
import { generateTopics } from './gemini.js';
import { enqueue } from './queue.js';

export async function seedTopics() {
  if ((await Topic.countDocuments()) === 0) await Topic.insertMany(SEED_TOPICS.map((text) => ({ text })));
}

export async function refillTopics(count = 20) {
  const existing = (await Topic.find().select('text')).map((t) => t.text);
  const fresh = await generateTopics(count, existing);
  const lower = new Set(existing.map((t) => t.toLowerCase()));
  const docs = fresh.filter((t) => !lower.has(t.toLowerCase())).map((text) => ({ text }));
  if (docs.length) await Topic.insertMany(docs, { ordered: false }).catch(() => {});
  return docs.length;
}

export async function createReel(topic, extra = {}) {
  const reel = await Reel.create({ topic, ...extra });
  enqueue(reel._id);
  return reel;
}

/** Daily batch: take N unused topics (auto-refill via Gemini when low), queue reels. */
export async function generateDailyBatch(n) {
  if ((await Topic.countDocuments({ used: false })) < n + 3) {
    try { await refillTopics(20); } catch (e) { console.error('topic refill failed:', e.message); }
  }
  const made = [];
  for (let i = 0; i < n; i++) {
    const [t] = await Topic.aggregate([{ $match: { used: false } }, { $sample: { size: 1 } }]);
    if (!t) break;
    await Topic.updateOne({ _id: t._id }, { used: true });
    made.push(await createReel(t.text));
  }
  return made;
}

/** Bulk: explicit topics (one reel each) and/or N AI-picked topics. Returns created reels. */
export async function bulkCreate({ topics = [], ideas = 0 } = {}) {
  const made = [];
  for (const t of topics.map((x) => String(x).trim()).filter(Boolean).slice(0, 50)) {
    await Topic.updateOne({ text: t }, { text: t, used: true }, { upsert: true });
    made.push(await createReel(t));
  }
  if (ideas > 0) made.push(...(await generateDailyBatch(Math.min(ideas, 30))));
  return made;
}
