import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Store {
  readonly path: string;
  db: DatabaseSync;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
    );
    this.schema();
  }

  all<Result>(sql: string, ...params: SQLInputValue[]): Result[] {
    return this.db.prepare(sql).all(...params) as unknown as Result[];
  }

  get<Result>(sql: string, ...params: SQLInputValue[]): Result | undefined {
    return this.db.prepare(sql).get(...params) as unknown as Result | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  meta<Result>(key: string): Result {
    const row = this.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      key,
    );
    if (!row) throw new Error(`Missing game metadata: ${key}`);
    return JSON.parse(row.value) as Result;
  }

  setMeta(key: string, value: unknown) {
    this.run(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }

  transaction<Result>(callback: () => Result): Result {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  schema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS countries (
        id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, continent TEXT NOT NULL,
        confederation TEXT NOT NULL, reputation INTEGER NOT NULL, language TEXT NOT NULL, region TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leagues (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, country_id INTEGER REFERENCES countries(id),
        confederation TEXT NOT NULL, tier INTEGER NOT NULL, age_group TEXT NOT NULL,
        kind TEXT NOT NULL, reputation INTEGER NOT NULL, format TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS clubs (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL, city TEXT NOT NULL,
        country_id INTEGER NOT NULL REFERENCES countries(id), league_id INTEGER REFERENCES leagues(id),
        type TEXT NOT NULL DEFAULT 'club', parent_id INTEGER REFERENCES clubs(id), age_group TEXT NOT NULL DEFAULT 'Senior',
        color TEXT NOT NULL, reputation INTEGER NOT NULL, academy INTEGER NOT NULL, facilities INTEGER NOT NULL,
        balance REAL NOT NULL, transfer_budget REAL NOT NULL, wage_budget REAL NOT NULL,
        philosophy TEXT NOT NULL, culture TEXT NOT NULL, formation TEXT NOT NULL, tactical_style TEXT NOT NULL,
        chemistry REAL NOT NULL, manager TEXT NOT NULL, manager_trust REAL NOT NULL, board_confidence REAL NOT NULL,
        board_pressure REAL NOT NULL, fan_mood REAL NOT NULL, fan_loyalty REAL NOT NULL, fan_patience REAL NOT NULL,
        expectations INTEGER NOT NULL, momentum REAL NOT NULL DEFAULT 0, crisis REAL NOT NULL DEFAULT 0, hype REAL NOT NULL DEFAULT 0,
        income REAL NOT NULL DEFAULT 0, spending REAL NOT NULL DEFAULT 0, season_spend REAL NOT NULL DEFAULT 0,
        ffp REAL NOT NULL DEFAULT 0, stadium TEXT NOT NULL, capacity INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, nationality TEXT NOT NULL, country_id INTEGER NOT NULL REFERENCES countries(id),
        club_id INTEGER REFERENCES clubs(id), parent_club_id INTEGER REFERENCES clubs(id),
        position TEXT NOT NULL, secondary_position TEXT NOT NULL, birth_date TEXT NOT NULL, age INTEGER NOT NULL,
        age_group TEXT NOT NULL, foot TEXT NOT NULL, ability REAL NOT NULL CHECK(ability BETWEEN 1 AND 99),
        base_potential REAL NOT NULL, potential REAL NOT NULL CHECK(potential BETWEEN 1 AND 99), volatility INTEGER NOT NULL,
        value REAL NOT NULL, wage REAL NOT NULL, contract_end TEXT NOT NULL, morale REAL NOT NULL, fitness REAL NOT NULL,
        injury_until TEXT, form REAL NOT NULL, goals INTEGER NOT NULL DEFAULT 0, assists INTEGER NOT NULL DEFAULT 0,
        appearances INTEGER NOT NULL DEFAULT 0, minutes INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL, training TEXT NOT NULL DEFAULT 'Balanced', intensity INTEGER NOT NULL DEFAULT 50,
        profile TEXT NOT NULL, shortlisted INTEGER NOT NULL DEFAULT 0, listed INTEGER NOT NULL DEFAULT 0,
        available_loan INTEGER NOT NULL DEFAULT 0, knowledge INTEGER NOT NULL DEFAULT 0,
        development_bank REAL NOT NULL DEFAULT 0, potential_bank REAL NOT NULL DEFAULT 0, loan_progress REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS player_club ON players(club_id, age_group, ability);
      CREATE INDEX IF NOT EXISTS player_nationality ON players(country_id, age, ability);
      CREATE INDEX IF NOT EXISTS player_filter ON players(position, age, ability, potential, value);
      CREATE INDEX IF NOT EXISTS player_name ON players(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS player_shortlist ON players(shortlisted) WHERE shortlisted = 1;
      CREATE TABLE IF NOT EXISTS standings (
        league_id INTEGER NOT NULL REFERENCES leagues(id), club_id INTEGER NOT NULL REFERENCES clubs(id),
        group_name TEXT NOT NULL DEFAULT '', played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, gf INTEGER NOT NULL DEFAULT 0,
        ga INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, xg REAL NOT NULL DEFAULT 0,
        xga REAL NOT NULL DEFAULT 0, xpts REAL NOT NULL DEFAULT 0, form TEXT NOT NULL DEFAULT '',
        home_record TEXT NOT NULL DEFAULT '0-0-0', away_record TEXT NOT NULL DEFAULT '0-0-0', deducted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(league_id, club_id)
      );
      CREATE TABLE IF NOT EXISTS fixtures (
        id INTEGER PRIMARY KEY, league_id INTEGER REFERENCES leagues(id), date TEXT NOT NULL, season INTEGER NOT NULL,
        home_id INTEGER NOT NULL REFERENCES clubs(id), away_id INTEGER NOT NULL REFERENCES clubs(id),
        stage TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT '', round INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled', home_goals INTEGER, away_goals INTEGER, home_xg REAL, away_xg REAL,
        seed TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', CHECK(home_id != away_id)
      );
      CREATE INDEX IF NOT EXISTS fixture_date ON fixtures(status, date);
      CREATE INDEX IF NOT EXISTS fixture_home ON fixtures(home_id, date);
      CREATE INDEX IF NOT EXISTS fixture_away ON fixtures(away_id, date);
      CREATE INDEX IF NOT EXISTS fixture_league ON fixtures(league_id, season, round);
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY, club_id INTEGER REFERENCES clubs(id), name TEXT NOT NULL, role TEXT NOT NULL,
        ability INTEGER NOT NULL, influence INTEGER NOT NULL, communication INTEGER NOT NULL,
        tactical_knowledge INTEGER NOT NULL, personality TEXT NOT NULL, ambition INTEGER NOT NULL,
        morale REAL NOT NULL, wage REAL NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS staff_club ON staff(club_id);
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL REFERENCES clubs(id), source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
        strength REAL NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source_type, source_id, target_type, target_id)
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), player_id INTEGER REFERENCES players(id),
        country_id INTEGER REFERENCES countries(id), position TEXT, max_age INTEGER NOT NULL DEFAULT 30,
        budget REAL NOT NULL DEFAULT 100000000, start_date TEXT NOT NULL, due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), staff_id INTEGER NOT NULL REFERENCES staff(id),
        date TEXT NOT NULL, accuracy INTEGER NOT NULL, ability_low INTEGER NOT NULL, ability_high INTEGER NOT NULL,
        potential_low INTEGER NOT NULL, potential_high INTEGER NOT NULL, fit INTEGER NOT NULL, risk INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS negotiations (
        id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), buying_club_id INTEGER NOT NULL REFERENCES clubs(id),
        selling_club_id INTEGER REFERENCES clubs(id), type TEXT NOT NULL, stage TEXT NOT NULL, tension REAL NOT NULL DEFAULT 15,
        asking_price REAL NOT NULL, offer REAL NOT NULL DEFAULT 0, wage REAL NOT NULL DEFAULT 0, interest REAL NOT NULL,
        created TEXT NOT NULL, deadline TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), parent_id INTEGER NOT NULL REFERENCES clubs(id),
        destination_id INTEGER NOT NULL REFERENCES clubs(id), type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', score REAL NOT NULL DEFAULT 50, pressure REAL NOT NULL DEFAULT 0,
        fit REAL NOT NULL, relationship REAL NOT NULL, terms TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS partnerships (
        id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL REFERENCES clubs(id), partner_id INTEGER NOT NULL REFERENCES clubs(id),
        type TEXT NOT NULL, strength REAL NOT NULL, data TEXT NOT NULL DEFAULT '{}', UNIQUE(club_id, partner_id)
      );
      CREATE TABLE IF NOT EXISTS sell_on_clauses (
        id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id),
        beneficiary_id INTEGER NOT NULL REFERENCES clubs(id), owner_id INTEGER NOT NULL REFERENCES clubs(id),
        percentage REAL NOT NULL CHECK(percentage BETWEEN 0 AND 100), source_loan_id INTEGER REFERENCES loans(id),
        status TEXT NOT NULL DEFAULT 'active', paid REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS loan_player ON loans(player_id, status);
      CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info', read INTEGER NOT NULL DEFAULT 0, action TEXT, data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL REFERENCES clubs(id), date TEXT NOT NULL,
        category TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY, season INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
        date TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_entity ON history(entity_type, entity_id, date);
      CREATE TABLE IF NOT EXISTS promises (
        id INTEGER PRIMARY KEY, player_id INTEGER REFERENCES players(id), type TEXT NOT NULL,
        target REAL NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS training_plans (
        club_id INTEGER PRIMARY KEY REFERENCES clubs(id), focus TEXT NOT NULL DEFAULT 'Balanced', intensity INTEGER NOT NULL DEFAULT 50,
        youth_focus TEXT NOT NULL DEFAULT 'Technical', data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS set_pieces (
        club_id INTEGER PRIMARY KEY REFERENCES clubs(id), routine TEXT NOT NULL DEFAULT 'Near post',
        target TEXT NOT NULL DEFAULT 'Centre-back', risk INTEGER NOT NULL DEFAULT 50, data TEXT NOT NULL DEFAULT '{}'
      );
    `);
  }
}
