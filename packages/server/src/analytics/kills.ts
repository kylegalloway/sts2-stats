import type Database from 'better-sqlite3';

export interface BossStat {
  boss: string;
  act: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  avg_hp_pct_wins: number | null;
  avg_hp_pct_losses: number | null;
}

export function getBossStats(db: Database.Database, character?: string): BossStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];
  return db.prepare(`
    SELECT
      fn.encounter_id AS boss,
      fn.act,
      COUNT(*) AS total,
      SUM(r.victory) AS wins,
      COUNT(*) - SUM(r.victory) AS losses,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(*), 0) AS win_rate,
      AVG(CASE WHEN r.victory = 1 THEN CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0) END) AS avg_hp_pct_wins,
      AVG(CASE WHEN r.victory = 0 THEN CAST(hg.hp AS REAL) / NULLIF(hg.max_hp, 0) END) AS avg_hp_pct_losses
    FROM floor_nodes fn
    JOIN runs r ON r.id = fn.run_id
    LEFT JOIN hp_gold_per_floor hg ON hg.run_id = fn.run_id AND hg.floor = fn.floor
    WHERE fn.node_type = 'boss' AND fn.encounter_id IS NOT NULL ${charAnd}
    GROUP BY fn.encounter_id, fn.act
    ORDER BY total DESC
  `).all(...params) as BossStat[];
}

export interface KillStat {
  killed_by: string;
  count: number;
  pct: number;
}

export function getKills(db: Database.Database, character?: string): KillStat[] {
  const where = character
    ? 'WHERE victory = 0 AND character = ?'
    : 'WHERE victory = 0';
  const params = character ? [character] : [];

  const total = (db.prepare(`SELECT COUNT(*) as n FROM runs ${where}`).get(...params) as { n: number }).n;

  return db.prepare(`
    SELECT killed_by, COUNT(*) AS count
    FROM runs ${where} AND killed_by IS NOT NULL
    GROUP BY killed_by ORDER BY count DESC
  `).all(...params).map((row: unknown) => {
    const r = row as { killed_by: string; count: number };
    return { ...r, pct: total > 0 ? r.count / total : 0 };
  });
}

export interface KillByFloorBand {
  floor_band: string;
  floor_lo: number;
  floor_hi: number;
  killed_by: string;
  count: number;
  pct_of_band: number;
}

export interface EnemyInflectionStat {
  encounter_id: string;
  room_type: string | null;
  // Number of runs where this encounter fell inside the worst 3-floor HP window.
  inflection_appearances: number;
  avg_damage_in_window: number | null;
  avg_hp_deficit: number | null;
  avg_floor_reached: number | null;
  win_rate: number | null;
  // How often this encounter is the kill shot (from runs.killed_by).
  kill_count: number;
}

// Encounters that most frequently appear inside a run's worst 3-floor HP drain
// window, and how bad those moments were. Identifies enemies that break you
// rather than just finish you.
export function getEnemyInflectionStats(db: Database.Database, character?: string): EnemyInflectionStat[] {
  const charAnd = character ? 'AND r.character = ?' : '';
  const params = character ? [character] : [];

  return db.prepare(`
    WITH inflection_window AS (
      SELECT
        dpf.run_id,
        dpf.encounter_id,
        dpf.room_type,
        dpf.damage_taken,
        ri.hp_deficit,
        ri.inflection_floor
      FROM damage_per_floor dpf
      JOIN run_inflection ri ON ri.run_id = dpf.run_id
      -- floor must be within the 3-floor window ending at inflection_floor
      WHERE dpf.floor > ri.inflection_floor - 3
        AND dpf.floor <= ri.inflection_floor
        AND dpf.encounter_id IS NOT NULL
        AND dpf.damage_taken > 0
    )
    SELECT
      iw.encounter_id,
      iw.room_type,
      COUNT(DISTINCT iw.run_id) AS inflection_appearances,
      AVG(iw.damage_taken) AS avg_damage_in_window,
      AVG(iw.hp_deficit) AS avg_hp_deficit,
      AVG(r.floor_reached) AS avg_floor_reached,
      CAST(SUM(r.victory) AS REAL) / NULLIF(COUNT(DISTINCT iw.run_id), 0) AS win_rate,
      COALESCE((
        SELECT COUNT(*) FROM runs r2
        WHERE r2.killed_by = iw.encounter_id ${character ? 'AND r2.character = ?' : ''}
      ), 0) AS kill_count
    FROM inflection_window iw
    JOIN runs r ON r.id = iw.run_id
    WHERE 1=1 ${charAnd}
    GROUP BY iw.encounter_id, iw.room_type
    HAVING COUNT(DISTINCT iw.run_id) >= 2
    ORDER BY avg_hp_deficit ASC
  `).all(...(character ? [...params, ...params] : [])) as EnemyInflectionStat[];
}

// Groups deaths by act-aligned floor bands: Act 1 (1-16), Act 2 (17-33), Act 3+ (34+).
// Within each band shows which enemies kill you most.
export function getKillsByFloorBand(db: Database.Database, character?: string): KillByFloorBand[] {
  const charAnd = character ? 'AND character = ?' : '';
  const params = character ? [character] : [];

  const bands: Array<{ label: string; lo: number; hi: number }> = [
    { label: 'Act 1', lo: 1, hi: 16 },
    { label: 'Act 2', lo: 17, hi: 33 },
    { label: 'Act 3+', lo: 34, hi: 9999 },
  ];

  const result: KillByFloorBand[] = [];

  for (const band of bands) {
    const bandTotal = (db.prepare(`
      SELECT COUNT(*) as n FROM runs
      WHERE victory = 0 AND floor_reached >= ? AND floor_reached <= ? ${charAnd}
    `).get(band.lo, band.hi, ...params) as { n: number }).n;

    const rows = db.prepare(`
      SELECT killed_by, COUNT(*) AS count
      FROM runs
      WHERE victory = 0 AND floor_reached >= ? AND floor_reached <= ?
        AND killed_by IS NOT NULL ${charAnd}
      GROUP BY killed_by
      ORDER BY count DESC
    `).all(band.lo, band.hi, ...params) as { killed_by: string; count: number }[];

    for (const row of rows) {
      result.push({
        floor_band: band.label,
        floor_lo: band.lo,
        floor_hi: band.hi,
        killed_by: row.killed_by,
        count: row.count,
        pct_of_band: bandTotal > 0 ? row.count / bandTotal : 0,
      });
    }
  }

  return result;
}
