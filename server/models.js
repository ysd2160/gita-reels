import mongoose from 'mongoose';
const { Schema } = mongoose;

const reelSchema = new Schema(
  {
    topic: { type: String, required: true },
    format: { type: String, enum: ['short', 'long'], default: 'short' },
    status: {
      type: String,
      default: 'queued',
      enum: ['queued', 'scripting', 'voice', 'visuals', 'render_wait', 'rendering', 'ready', 'approved', 'rejected', 'published', 'failed'],
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
    retries: { type: Number, default: 0 }, // automatic re-tries after a failed generation
  },
  { timestamps: true },
);

const topicSchema = new Schema(
  { text: { type: String, required: true, unique: true }, used: { type: Boolean, default: false } },
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
  },
  { timestamps: true },
);

const settingSchema = new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed });

export const Reel = mongoose.model('Reel', reelSchema);
export const Topic = mongoose.model('Topic', topicSchema);
export const Plan = mongoose.model('Plan', planSchema);
export const Setting = mongoose.model('Setting', settingSchema);

export const SEED_TOPICS = [
  'Overthinking', 'Heartbreak', 'Failure', 'Anxiety', 'Anger', 'Loneliness', 'Comparing yourself with others',
  'Fear of the future', 'Self-doubt', 'Betrayal by a close friend', 'Burnout and exhaustion', 'Regret about the past',
  'Not getting results despite hard work', 'Peer pressure', 'Feeling lost in life',
];
export const SEED_LONG = [
  '5 Gita lessons when life feels stuck', 'How Krishna teaches you to stop overthinking', '5 Gita secrets for a calm mind',
  'What the Gita says about failure and comebacks', '5 lessons from the Gita for heartbreak',
];
