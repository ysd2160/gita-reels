import mongoose from 'mongoose';
import { currentUserId } from './context.js';

/**
 * Multi-user isolation in ONE place. Add this plugin to a schema and:
 *  - the document gets a `userId` field (set automatically from the logged-in user on create),
 *  - every find / update / delete / count / aggregate is filtered by the current user.
 * Outside a user context (system code: startup, orphan cleanup) nothing is filtered.
 * To deliberately look at all users inside a request use  Model.find().setOptions({ allUsers: true }).
 */
export function tenantPlugin(schema) {
  schema.add({ userId: { type: mongoose.Schema.Types.ObjectId, index: true } });

  const QUERIES = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'countDocuments', 'distinct'];
  schema.pre(QUERIES, { query: true, document: false }, function () {
    const uid = currentUserId();
    if (!uid || this.getOptions().allUsers) return;
    this.setQuery({ ...this.getFilter(), userId: uid });
  });

  schema.pre('aggregate', function () {
    const uid = currentUserId();
    if (uid) this.pipeline().unshift({ $match: { userId: uid } });
  });

  schema.pre('validate', function () {
    if (this.isNew && !this.userId) { const uid = currentUserId(); if (uid) this.userId = uid; }
  });
  schema.pre('insertMany', function (next, docs) {
    const uid = currentUserId();
    if (uid) for (const d of Array.isArray(docs) ? docs : [docs]) if (d && !d.userId) d.userId = uid;
    next();
  });
}
