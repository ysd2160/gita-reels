import mongoose from 'mongoose';
import { tenantPlugin } from './tenancy.js';
const { Schema } = mongoose;

const reelSchema = new Schema(
  {
    topic: { type: String, required: true },
    format: { type: String, enum: ['short', 'long'], default: 'short' },
    status: {
      type: String,
      default: 'queued',
      enum: ['queued', 'scripting', 'voice', 'visuals', 'render_wait', 'rendering', 'ready', 'approved', 'rejected', 'published', 'failed', 'paused'],
    },
    progress: { type: Number, default: 0 },
    error: String,
    script: Schema.Types.Mixed,
    style: Schema.Types.Mixed,
    project: Schema.Types.Mixed, // the editable video (all props the Remotion composition needs)
    durationSec: Number,
    videoFile: String,
    visualIds: [String],
    scheduledFor: Date, // when it should be published
    chapters: Schema.Types.Mixed, // [{at,title}] for YouTube chapters
    publish: Schema.Types.Mixed, // { youtube:{state,id,url,error}, instagram:{...} }
    planId: Schema.Types.ObjectId,
    genAt: Date, // when the video finished rendering (start of the 24h file-retention clock)
    purgedAt: Date, // all files were deleted by the storage keeper (record + post links stay)
    pausedStage: String, // where a paused video stopped (scripting | voice | visuals | render_wait)
    work: Schema.Types.Mixed, // saved steps of an unfinished video { voice, style, scenes } -> resume continues from here
    retries: { type: Number, default: 0 }, // automatic re-tries after a failed generation
    formatId: String, // reel format (classic / story / mystery ...), see server/formats.js
    targetSec: Number, // wanted length (seconds)
    notes: String, // creator's notes for the script
    pillar: String, // content pillar (overthinking | career | relationships) - to compare which topics work
    hookStyle: String, // how the first line hooks (mid_scene | number | contradiction | you_call | question)
  },
  { timestamps: true },
);

const topicSchema = new Schema(
  { text: { type: String, required: true }, used: { type: Boolean, default: false } },
  { timestamps: true },
);

// Content calendar: what will be made on which day
const planSchema = new Schema(
  {
    date: { type: String, index: true }, // YYYY-MM-DD (IST)
    slot: Number, // order inside the day
    kind: { type: String, enum: ['short', 'long'], default: 'short' },
    topic: String,
    publishTime: String, // HH:MM (IST)
    status: { type: String, enum: ['planned', 'generating', 'done', 'skipped'], default: 'planned' },
    reelId: Schema.Types.ObjectId,
    script: Schema.Types.Mixed, // reviewed / pasted script; used as-is when the video is made
    formatId: String, // reel format id (server/formats.js); empty = chosen automatically
    targetSec: Number, // wanted length in seconds (30-60); empty = automatic
    notes: String, // creator's notes / angle for this video (from the week plan)
    pillar: String, // content pillar chosen for this video
    sourceText: String, // full script text found in an imported plan (kept word for word)
  },
  { timestamps: true },
);

const settingSchema = new Schema({ key: { type: String }, value: Schema.Types.Mixed });

// every user has their own topics / settings: uniqueness is per user
topicSchema.index({ userId: 1, text: 1 }, { unique: true });
settingSchema.index({ userId: 1, key: 1 }, { unique: true });

// ---- multi-user: these four collections belong to ONE user each (see tenancy.js) ----
for (const s of [reelSchema, topicSchema, planSchema, settingSchema]) s.plugin(tenantPlugin);

// Login accounts. NOT tenant-scoped (this is the tenant list itself).
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passHash: { type: String, required: true }, // scrypt$salt$hash
    isAdmin: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const Reel = mongoose.model('Reel', reelSchema);
export const Topic = mongoose.model('Topic', topicSchema);
export const Plan = mongoose.model('Plan', planSchema);
export const Setting = mongoose.model('Setting', settingSchema);
export const User = mongoose.model('User', userSchema);

export const SEED_TOPICS = [
  'Overthinking', 'Heartbreak', 'Failure', 'Anxiety', 'Anger', 'Loneliness', 'Comparing yourself with others',
  'Fear of the future', 'Self-doubt', 'Betrayal by a close friend', 'Burnout and exhaustion', 'Regret about the past',
  'Not getting results despite hard work', 'Peer pressure', 'Feeling lost in life',
];
export const SEED_LONG = [
  '5 Gita lessons when life feels stuck', 'How Krishna teaches you to stop overthinking', '5 Gita secrets for a calm mind',
  'What the Gita says about failure and comebacks', '5 lessons from the Gita for heartbreak',
];

/** Old single-user installs: drop the old global unique indexes (they would block a second user with the same topic / setting key). */
export async function migrateIndexes() {
  for (const [M, name] of [[Setting, 'key_1'], [Topic, 'text_1']]) {
    try { await M.collection.dropIndex(name); console.log(`[migrate] dropped old index ${M.collection.name}.${name}`); } catch { /* not there = fine */ }
    await M.createIndexes().catch((e) => console.warn('[migrate] index', e.message));
  }
}

/** Old single-user data (no userId) belongs to the admin: runs at startup, harmless when there is nothing to claim. */
export async function claimLegacyData(userId) {
  let n = 0;
  for (const M of [Reel, Plan, Topic, Setting]) {
    const r = await M.updateMany({ userId: { $exists: false } }, { $set: { userId } }).setOptions({ allUsers: true });
    n += r.modifiedCount || 0;
  }
  if (n) console.log(`[migrate] ${n} old record(s) now belong to the admin user`);
  return n;
}
