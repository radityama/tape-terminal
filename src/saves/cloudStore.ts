import type { SupabaseClient } from '@supabase/supabase-js';
import { SaveGame, SaveGameSchema, SaveMeta, SCHEMA_VERSION, SAVE_SIZE_HARD_LIMIT } from './schema';
import { migrate, RawSave, rawSchemaVersion, SaveVersionError } from './migrations';
import { PutResult, SaveCorruptError, SaveStore } from './localStore';

interface SaveListRow {
  slot: number;
  name: string;
  seed: string;
  mode: 'career' | 'sandbox';
  rank: string | null;
  equity: number | string | null;
  sim_day: number | null;
  updated_at: string;
  revision: number;
  device_id: string;
}

interface CloudProfile {
  data: unknown;
  updatedAt: number;
}

// CloudSaveStore talks to PostgREST directly from the browser. Ownership is enforced by RLS,
// so the client never needs a custom API route or the service role key.
export class CloudSaveStore implements SaveStore {
  constructor(
    private client: SupabaseClient,
    private userId: string
  ) {}

  async list(): Promise<SaveMeta[]> {
    const { data, error } = await this.client
      .from('saves')
      .select('slot,name,seed,mode,rank,equity,sim_day,updated_at,revision,device_id')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);

    return ((data ?? []) as SaveListRow[]).map((row) => ({
      slot: row.slot,
      name: row.name,
      seed: row.seed,
      mode: row.mode,
      rank: row.rank,
      equity: Number(row.equity ?? 0),
      simDay: row.sim_day ?? 1,
      updatedAt: new Date(row.updated_at).getTime(),
      revision: row.revision,
      deviceId: row.device_id,
    }));
  }

  async get(slot: number): Promise<SaveGame | null> {
    const { data, error } = await this.client.from('saves').select('payload').eq('slot', slot).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    // Never trust cloud data: validate and migrate exactly like a local save.
    const raw = data.payload as RawSave;
    const version = rawSchemaVersion(raw);
    if (version > SCHEMA_VERSION) throw new SaveVersionError(version, SCHEMA_VERSION);

    const parsed = SaveGameSchema.safeParse(migrate(raw));
    if (!parsed.success) throw new SaveCorruptError(parsed.error.message);
    return parsed.data;
  }

  async put(save: SaveGame, opts?: { expectedRevision?: number }): Promise<PutResult> {
    let encoded: unknown;
    try {
      encoded = SaveGameSchema.encode(save);
    } catch (err) {
      return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : 'invalid save' };
    }

    const json = JSON.stringify(encoded);
    if (json.length > SAVE_SIZE_HARD_LIMIT) return { ok: false, reason: 'too_large' };

    const row = {
      user_id: this.userId,
      slot: save.slot,
      name: save.name,
      seed: save.seed,
      mode: save.mode,
      schema_version: SCHEMA_VERSION,
      rank: save.summary.rank,
      equity: save.summary.equity,
      sim_day: save.summary.simDay,
      payload: encoded,
      device_id: save.deviceId,
    };

    // No base revision: only used by the claim flow, which creates the row if missing.
    if (opts?.expectedRevision === undefined) {
      const { data, error } = await this.client
        .from('saves')
        .upsert(row, { onConflict: 'user_id,slot' })
        .select('revision')
        .single();
      if (error) return { ok: false, reason: 'invalid', message: error.message };
      return { ok: true, revision: (data as { revision: number }).revision };
    }

    // Optimistic concurrency: update only the revision we last read.
    const { data, error } = await this.client
      .from('saves')
      .update(row)
      .eq('user_id', this.userId)
      .eq('slot', save.slot)
      .eq('revision', opts.expectedRevision)
      .select('revision')
      .maybeSingle();
    if (error) return { ok: false, reason: 'invalid', message: error.message };

    if (!data) {
      const { data: existing } = await this.client
        .from('saves')
        .select('revision')
        .eq('user_id', this.userId)
        .eq('slot', save.slot)
        .maybeSingle();

      if (!existing) {
        const { data: inserted, error: insertError } = await this.client
          .from('saves')
          .insert({ ...row, revision: opts.expectedRevision })
          .select('revision')
          .single();
        if (insertError) return { ok: false, reason: 'invalid', message: insertError.message };
        return { ok: true, revision: (inserted as { revision: number }).revision };
      }

      return { ok: false, reason: 'conflict', remoteRevision: existing.revision };
    }

    return { ok: true, revision: (data as { revision: number }).revision };
  }

  async delete(slot: number): Promise<void> {
    await this.client.from('saves').delete().eq('slot', slot);
  }

  async getMeta(slot: number): Promise<SaveMeta | null> {
    const { data, error } = await this.client
      .from('saves')
      .select('slot,name,seed,mode,rank,equity,sim_day,updated_at,revision,device_id')
      .eq('slot', slot)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as SaveListRow;
    return {
      slot: row.slot,
      name: row.name,
      seed: row.seed,
      mode: row.mode,
      rank: row.rank,
      equity: Number(row.equity ?? 0),
      simDay: row.sim_day ?? 1,
      updatedAt: new Date(row.updated_at).getTime(),
      revision: row.revision,
      deviceId: row.device_id,
    };
  }

  async getProfile(): Promise<CloudProfile | null> {
    const { data, error } = await this.client.from('profiles').select('data,updated_at').maybeSingle();
    if (error || !data) return null;
    const row = data as { data: unknown; updated_at: string };
    return { data: row.data, updatedAt: new Date(row.updated_at).getTime() };
  }

  async putProfile(data: unknown): Promise<void> {
    await this.client
      .from('profiles')
      .upsert({ user_id: this.userId, data }, { onConflict: 'user_id' });
  }
}
