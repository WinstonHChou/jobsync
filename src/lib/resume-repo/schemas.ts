import { z } from "zod";
export const layoutSchema = z.array(z.object({ id: z.string().min(1).max(80), title: z.string().trim().min(1).max(100), entries: z.array(z.object({ macro: z.string().regex(/^[A-Za-z]+$/), starred: z.boolean() })).max(25) })).min(1).max(15);
export const editsSchema = z.array(z.object({ blockId: z.string().regex(/^[a-f0-9]{24}$/), replacement: z.string().max(9000), reason: z.string().max(1500), accepted: z.boolean(), factsConfirmed: z.boolean() })).max(100);
export const suggestionsSchema = z.object({ layout: layoutSchema.optional(), edits: z.array(z.object({ blockId: z.string().regex(/^[a-f0-9]{24}$/), replacement: z.string().max(9000), reason: z.string().min(1).max(1500) })).max(20) });
export const saveDraftSchema = z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative(), layout: layoutSchema, edits: editsSchema });
