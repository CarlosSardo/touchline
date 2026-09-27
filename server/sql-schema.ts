export const WORLD_TABLES = [
  "meta",
  "countries",
  "leagues",
  "clubs",
  "players",
  "standings",
  "fixtures",
  "staff",
  "club_support",
  "relationships",
  "assignments",
  "reports",
  "negotiations",
  "loans",
  "partnerships",
  "board_affiliate_requests",
  "unexpected_events",
  "sell_on_clauses",
  "transfer_payments",
  "buy_back_clauses",
  "news",
  "competition_favorites",
  "ledger",
  "history",
  "discipline",
  "financial_periods",
  "player_assets",
  "registration_records",
  "minor_applications",
  "player_season_stats",
  "player_match_appearances",
  "promises",
  "training_plans",
  "set_pieces",
] as const;

export const IDENTITY_TABLES: ReadonlySet<string> = new Set([
  "countries",
  "leagues",
  "clubs",
  "players",
  "fixtures",
  "staff",
  "relationships",
  "assignments",
  "reports",
  "negotiations",
  "loans",
  "partnerships",
  "board_affiliate_requests",
  "unexpected_events",
  "sell_on_clauses",
  "transfer_payments",
  "buy_back_clauses",
  "news",
  "ledger",
  "history",
  "player_assets",
  "minor_applications",
  "promises",
]);

export const STORE_TABLES: ReadonlySet<string> = new Set([
  ...WORLD_TABLES,
  "schema_migrations",
  "save_slots",
  "save_chunks",
]);

export interface SqlMigration {
  version: number;
  name: string;
  statements: string[];
}

export function quoteIdentifier(name: string): string {
  if (!name || name.length > 128 || name.includes("\0"))
    throw new Error("Invalid SQL identifier.");
  return `[${name.replaceAll("]", "]]")}]`;
}

export function sqlLiteral(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`;
}

export function tableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function migrationTableSql(schema: string): string {
  const table = tableName(schema, "schema_migrations");
  return `IF OBJECT_ID(${sqlLiteral(table)}, N'U') IS NULL
    CREATE TABLE ${table} ([version] INT NOT NULL PRIMARY KEY,
      [name] NVARCHAR(200) NOT NULL, [applied_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());`;
}

export function accountsTableSql(schema: string): string {
  const table = tableName(schema, "users");
  return `IF OBJECT_ID(${sqlLiteral(table)}, N'U') IS NULL
    CREATE TABLE ${table} (
      [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
      [tenant_id] UNIQUEIDENTIFIER NOT NULL,
      [object_id] UNIQUEIDENTIFIER NOT NULL,
      [display_name] NVARCHAR(200) NOT NULL,
      [email] NVARCHAR(320) NULL,
      [game_schema] NVARCHAR(128) COLLATE Latin1_General_100_CI_AS NOT NULL UNIQUE,
      [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      [updated_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      UNIQUE ([tenant_id], [object_id]),
      CHECK ([game_schema] <> ${sqlLiteral(schema)} AND [game_schema] NOT IN (N'accounts', N'sys', N'guest', N'information_schema'))
    );`;
}

export function inviteRequestsTableSql(schema: string): string {
  const table = tableName(schema, "invite_requests");
  const attempts = tableName(schema, "invite_attempts");
  return `IF OBJECT_ID(${sqlLiteral(table)}, N'U') IS NULL
    CREATE TABLE ${table} (
      [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
      [email] NVARCHAR(320) COLLATE Latin1_General_100_CI_AS NOT NULL,
      [note] NVARCHAR(500) NULL,
      [status] NVARCHAR(16) NOT NULL,
      [ip_hash] CHAR(64) NULL,
      [requested_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      [decided_at] DATETIME2 NULL,
      [decided_by] NVARCHAR(320) NULL,
      [account_id] UNIQUEIDENTIFIER NULL,
      [approval_email_sent] BIT NOT NULL DEFAULT 0,
      [accepted_email_sent] BIT NOT NULL DEFAULT 0,
      [updated_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [CK_invite_requests_status] CHECK ([status] IN (N'pending', N'accepted', N'denied', N'claimed'))
    );
  IF COL_LENGTH(${sqlLiteral(table)}, N'note') IS NULL ALTER TABLE ${table} ADD [note] NVARCHAR(500) NULL;
  IF COL_LENGTH(${sqlLiteral(table)}, N'ip_hash') IS NULL ALTER TABLE ${table} ADD [ip_hash] CHAR(64) NULL;
  IF COL_LENGTH(${sqlLiteral(table)}, N'decided_at') IS NULL ALTER TABLE ${table} ADD [decided_at] DATETIME2 NULL;
  IF COL_LENGTH(${sqlLiteral(table)}, N'decided_by') IS NULL ALTER TABLE ${table} ADD [decided_by] NVARCHAR(320) NULL;
  IF COL_LENGTH(${sqlLiteral(table)}, N'account_id') IS NULL ALTER TABLE ${table} ADD [account_id] UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(${sqlLiteral(table)}, N'approval_email_sent') IS NULL
    ALTER TABLE ${table} ADD [approval_email_sent] BIT NOT NULL CONSTRAINT [DF_invite_requests_approval_email_sent] DEFAULT 0;
  IF COL_LENGTH(${sqlLiteral(table)}, N'accepted_email_sent') IS NULL
    ALTER TABLE ${table} ADD [accepted_email_sent] BIT NOT NULL CONSTRAINT [DF_invite_requests_accepted_email_sent] DEFAULT 0;
  IF COL_LENGTH(${sqlLiteral(table)}, N'updated_at') IS NULL
    ALTER TABLE ${table} ADD [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_invite_requests_updated_at] DEFAULT SYSUTCDATETIME();
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE [parent_object_id] = OBJECT_ID(${sqlLiteral(table)}) AND [name] = N'CK_invite_requests_status')
    ALTER TABLE ${table} WITH CHECK ADD CONSTRAINT [CK_invite_requests_status]
      CHECK ([status] IN (N'pending', N'accepted', N'denied', N'claimed'));
  IF NOT EXISTS (SELECT 1 FROM sys.indexes
    WHERE [object_id] = OBJECT_ID(${sqlLiteral(table)}) AND [name] = N'UX_invite_requests_email_active')
    CREATE UNIQUE INDEX [UX_invite_requests_email_active] ON ${table}([email])
      WHERE [status] IN (N'pending', N'accepted', N'claimed');
  IF OBJECT_ID(${sqlLiteral(attempts)}, N'U') IS NULL
    CREATE TABLE ${attempts} (
      [id] BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      [ip_hash] CHAR(64) NULL,
      [attempted_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  IF NOT EXISTS (SELECT 1 FROM sys.indexes
    WHERE [object_id] = OBJECT_ID(${sqlLiteral(attempts)}) AND [name] = N'IX_invite_attempts_attempted_at')
    CREATE INDEX [IX_invite_attempts_attempted_at] ON ${attempts}([attempted_at]);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes
    WHERE [object_id] = OBJECT_ID(${sqlLiteral(attempts)}) AND [name] = N'IX_invite_attempts_ip_hash_attempted_at')
    CREATE INDEX [IX_invite_attempts_ip_hash_attempted_at] ON ${attempts}([ip_hash], [attempted_at]);`;
}

export function schemaMigrations(schema: string): SqlMigration[] {
  const ref = (table: string) => tableName(schema, table);
  const definitions: Record<(typeof WORLD_TABLES)[number], string> = {
    meta: `[key] NVARCHAR(200) NOT NULL PRIMARY KEY, [value] NVARCHAR(max) NOT NULL`,
    countries: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [code] NVARCHAR(16) NOT NULL UNIQUE,
      [name] NVARCHAR(max) NOT NULL, [continent] NVARCHAR(max) NOT NULL,
      [confederation] NVARCHAR(max) NOT NULL, [reputation] FLOAT(53) NOT NULL,
      [language] NVARCHAR(max) NOT NULL, [region] NVARCHAR(max) NOT NULL`,
    leagues: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [name] NVARCHAR(max) NOT NULL,
      [country_id] INT NULL REFERENCES ${ref("countries")}([id]),
      [confederation] NVARCHAR(max) NOT NULL, [tier] INT NOT NULL, [age_group] NVARCHAR(max) NOT NULL,
      [kind] NVARCHAR(max) NOT NULL, [reputation] FLOAT(53) NOT NULL, [format] NVARCHAR(max) NOT NULL,
      [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    clubs: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [name] NVARCHAR(max) NOT NULL,
      [short_name] NVARCHAR(max) NOT NULL, [city] NVARCHAR(max) NOT NULL,
      [country_id] INT NOT NULL REFERENCES ${ref("countries")}([id]),
      [league_id] INT NULL REFERENCES ${ref("leagues")}([id]), [type] NVARCHAR(max) NOT NULL DEFAULT N'club',
      [parent_id] INT NULL REFERENCES ${ref("clubs")}([id]), [age_group] NVARCHAR(max) NOT NULL DEFAULT N'Senior',
      [color] NVARCHAR(max) NOT NULL, [reputation] FLOAT(53) NOT NULL, [academy] INT NOT NULL, [facilities] FLOAT(53) NOT NULL,
      [balance] FLOAT(53) NOT NULL, [transfer_budget] FLOAT(53) NOT NULL, [wage_budget] FLOAT(53) NOT NULL,
      [philosophy] NVARCHAR(max) NOT NULL, [culture] NVARCHAR(max) NOT NULL,
      [formation] NVARCHAR(max) NOT NULL, [tactical_style] NVARCHAR(max) NOT NULL,
      [chemistry] FLOAT(53) NOT NULL, [manager] NVARCHAR(max) NOT NULL, [manager_trust] FLOAT(53) NOT NULL,
      [board_confidence] FLOAT(53) NOT NULL, [board_pressure] FLOAT(53) NOT NULL, [fan_mood] FLOAT(53) NOT NULL,
      [fan_loyalty] FLOAT(53) NOT NULL, [fan_patience] FLOAT(53) NOT NULL, [expectations] INT NOT NULL,
      [momentum] FLOAT(53) NOT NULL DEFAULT 0, [crisis] FLOAT(53) NOT NULL DEFAULT 0, [hype] FLOAT(53) NOT NULL DEFAULT 0,
      [income] FLOAT(53) NOT NULL DEFAULT 0, [spending] FLOAT(53) NOT NULL DEFAULT 0,
      [season_spend] FLOAT(53) NOT NULL DEFAULT 0, [ffp] FLOAT(53) NOT NULL DEFAULT 0,
      [stadium] NVARCHAR(max) NOT NULL, [capacity] INT NOT NULL, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    players: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      [name] NVARCHAR(200) COLLATE Latin1_General_100_CI_AS_SC NOT NULL, [nationality] NVARCHAR(max) NOT NULL,
      [country_id] INT NOT NULL REFERENCES ${ref("countries")}([id]),
      [club_id] INT NULL REFERENCES ${ref("clubs")}([id]), [parent_club_id] INT NULL REFERENCES ${ref("clubs")}([id]),
      [position] NVARCHAR(16) NOT NULL, [secondary_position] NVARCHAR(max) NOT NULL,
      [birth_date] NVARCHAR(max) NOT NULL, [age] INT NOT NULL, [age_group] NVARCHAR(32) NOT NULL,
      [foot] NVARCHAR(max) NOT NULL, [ability] FLOAT(53) NOT NULL CHECK([ability] BETWEEN 1 AND 99),
      [base_potential] FLOAT(53) NOT NULL, [potential] FLOAT(53) NOT NULL CHECK([potential] BETWEEN 1 AND 99),
      [volatility] INT NOT NULL, [value] FLOAT(53) NOT NULL, [wage] FLOAT(53) NOT NULL,
      [contract_end] NVARCHAR(10) NOT NULL, [morale] FLOAT(53) NOT NULL, [fitness] FLOAT(53) NOT NULL,
      [injury_until] NVARCHAR(10) NULL, [form] FLOAT(53) NOT NULL, [goals] INT NOT NULL DEFAULT 0,
      [assists] INT NOT NULL DEFAULT 0, [appearances] INT NOT NULL DEFAULT 0, [minutes] INT NOT NULL DEFAULT 0,
      [role] NVARCHAR(100) NOT NULL, [training] NVARCHAR(max) NOT NULL DEFAULT N'Balanced',
      [intensity] INT NOT NULL DEFAULT 50, [profile] NVARCHAR(max) NOT NULL,
      [shortlisted] INT NOT NULL DEFAULT 0, [listed] INT NOT NULL DEFAULT 0,
      [available_loan] INT NOT NULL DEFAULT 0, [knowledge] INT NOT NULL DEFAULT 0,
      [development_bank] FLOAT(53) NOT NULL DEFAULT 0, [potential_bank] FLOAT(53) NOT NULL DEFAULT 0,
      [loan_progress] FLOAT(53) NOT NULL DEFAULT 0`,
    standings: `
      [league_id] INT NOT NULL REFERENCES ${ref("leagues")}([id]), [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [group_name] NVARCHAR(max) NOT NULL DEFAULT N'', [played] INT NOT NULL DEFAULT 0,
      [wins] INT NOT NULL DEFAULT 0, [draws] INT NOT NULL DEFAULT 0, [losses] INT NOT NULL DEFAULT 0,
      [gf] INT NOT NULL DEFAULT 0, [ga] INT NOT NULL DEFAULT 0, [points] INT NOT NULL DEFAULT 0,
      [xg] FLOAT(53) NOT NULL DEFAULT 0, [xga] FLOAT(53) NOT NULL DEFAULT 0, [xpts] FLOAT(53) NOT NULL DEFAULT 0,
      [form] NVARCHAR(max) NOT NULL DEFAULT N'', [home_record] NVARCHAR(max) NOT NULL DEFAULT N'0-0-0',
      [away_record] NVARCHAR(max) NOT NULL DEFAULT N'0-0-0', [deducted] INT NOT NULL DEFAULT 0,
      PRIMARY KEY([league_id], [club_id])`,
    fixtures: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [league_id] INT NULL REFERENCES ${ref("leagues")}([id]),
      [date] NVARCHAR(10) NOT NULL, [season] INT NOT NULL,
      [home_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [away_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [stage] NVARCHAR(max) NOT NULL, [group_name] NVARCHAR(max) NOT NULL DEFAULT N'', [round] INT NOT NULL,
      [status] NVARCHAR(32) NOT NULL DEFAULT N'scheduled', [home_goals] INT NULL, [away_goals] INT NULL,
      [home_xg] FLOAT(53) NULL, [away_xg] FLOAT(53) NULL, [seed] NVARCHAR(max) NOT NULL,
      [data] NVARCHAR(max) NOT NULL DEFAULT N'{}', CHECK([home_id] <> [away_id])`,
    staff: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NULL REFERENCES ${ref("clubs")}([id]),
      [name] NVARCHAR(max) NOT NULL, [role] NVARCHAR(100) NOT NULL, [ability] FLOAT(53) NOT NULL,
      [influence] INT NOT NULL, [communication] INT NOT NULL, [tactical_knowledge] FLOAT(53) NOT NULL,
      [personality] NVARCHAR(max) NOT NULL, [ambition] INT NOT NULL, [morale] FLOAT(53) NOT NULL,
      [wage] FLOAT(53) NOT NULL, [data] NVARCHAR(max) NOT NULL`,
    club_support: `
      [club_id] INT NOT NULL PRIMARY KEY REFERENCES ${ref("clubs")}([id]),
      [duties] NVARCHAR(max) NOT NULL DEFAULT N'{}', [weekly_budget] FLOAT(53) NOT NULL DEFAULT 5000,
      [last_run] NVARCHAR(max) NULL`,
    relationships: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [source_type] NVARCHAR(100) NOT NULL, [source_id] INT NOT NULL,
      [target_type] NVARCHAR(100) NOT NULL, [target_id] INT NOT NULL, [strength] FLOAT(53) NOT NULL,
      [kind] NVARCHAR(max) NOT NULL, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}',
      UNIQUE([source_type], [source_id], [target_type], [target_id])`,
    assignments: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [staff_id] INT NOT NULL REFERENCES ${ref("staff")}([id]),
      [player_id] INT NULL REFERENCES ${ref("players")}([id]), [country_id] INT NULL REFERENCES ${ref("countries")}([id]),
      [position] NVARCHAR(max) NULL, [max_age] INT NOT NULL DEFAULT 30, [budget] FLOAT(53) NOT NULL DEFAULT 100000000,
      [start_date] NVARCHAR(max) NOT NULL, [due_date] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(max) NOT NULL DEFAULT N'active', [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    reports: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [staff_id] INT NOT NULL REFERENCES ${ref("staff")}([id]), [date] NVARCHAR(max) NOT NULL,
      [accuracy] INT NOT NULL, [ability_low] INT NOT NULL, [ability_high] INT NOT NULL,
      [potential_low] INT NOT NULL, [potential_high] INT NOT NULL, [fit] INT NOT NULL, [risk] INT NOT NULL,
      [data] NVARCHAR(max) NOT NULL`,
    negotiations: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [buying_club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [selling_club_id] INT NULL REFERENCES ${ref("clubs")}([id]), [type] NVARCHAR(max) NOT NULL,
      [stage] NVARCHAR(max) NOT NULL, [tension] FLOAT(53) NOT NULL DEFAULT 15,
      [asking_price] FLOAT(53) NOT NULL, [offer] FLOAT(53) NOT NULL DEFAULT 0, [wage] FLOAT(53) NOT NULL DEFAULT 0,
      [interest] FLOAT(53) NOT NULL, [created] NVARCHAR(max) NOT NULL, [deadline] NVARCHAR(max) NOT NULL,
      [public] INT NOT NULL DEFAULT 0, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    loans: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [parent_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [destination_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [type] NVARCHAR(max) NOT NULL, [start_date] NVARCHAR(max) NOT NULL, [end_date] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(32) NOT NULL DEFAULT N'active', [score] FLOAT(53) NOT NULL DEFAULT 50,
      [pressure] FLOAT(53) NOT NULL DEFAULT 0, [fit] FLOAT(53) NOT NULL, [relationship] FLOAT(53) NOT NULL,
      [terms] NVARCHAR(max) NOT NULL, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    partnerships: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [partner_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [type] NVARCHAR(max) NOT NULL,
      [strength] FLOAT(53) NOT NULL, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}', UNIQUE([club_id], [partner_id])`,
    board_affiliate_requests: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [purpose] NVARCHAR(max) NOT NULL, [preferred_club_id] INT NULL REFERENCES ${ref("clubs")}([id]),
      [requested_date] NVARCHAR(max) NOT NULL, [due_date] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(32) NOT NULL DEFAULT N'pending', [decision_date] NVARCHAR(max) NULL,
      [reason] NVARCHAR(max) NOT NULL DEFAULT N'', [partner_id] INT NULL REFERENCES ${ref("clubs")}([id])`,
    unexpected_events: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [date] NVARCHAR(10) NOT NULL, [kind] NVARCHAR(max) NOT NULL, [title] NVARCHAR(max) NOT NULL,
      [body] NVARCHAR(max) NOT NULL, [deadline] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(32) NOT NULL DEFAULT N'pending', [resolved_date] NVARCHAR(max) NULL,
      [choice_id] NVARCHAR(max) NULL, [outcome] NVARCHAR(max) NOT NULL DEFAULT N'',
      [data] NVARCHAR(max) NOT NULL, UNIQUE([club_id], [date])`,
    sell_on_clauses: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [beneficiary_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [owner_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [percentage] FLOAT(53) NOT NULL CHECK([percentage] BETWEEN 0 AND 100),
      [source_loan_id] INT NULL REFERENCES ${ref("loans")}([id]),
      [status] NVARCHAR(max) NOT NULL DEFAULT N'active', [paid] FLOAT(53) NOT NULL DEFAULT 0`,
    transfer_payments: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [negotiation_id] INT NOT NULL REFERENCES ${ref("negotiations")}([id]),
      [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]), [payer_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [payee_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [amount] FLOAT(53) NOT NULL CHECK([amount] > 0),
      [due_date] NVARCHAR(10) NOT NULL, [paid_date] NVARCHAR(10) NULL, [kind] NVARCHAR(max) NOT NULL DEFAULT N'fee',
      [sell_on_clause_id] INT NULL REFERENCES ${ref("sell_on_clauses")}([id])`,
    buy_back_clauses: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      [negotiation_id] INT NOT NULL UNIQUE REFERENCES ${ref("negotiations")}([id]),
      [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [beneficiary_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [owner_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [fee] FLOAT(53) NOT NULL CHECK([fee] > 0), [expires] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(32) NOT NULL DEFAULT N'active'`,
    news: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [date] NVARCHAR(max) NOT NULL,
      [category] NVARCHAR(max) NOT NULL, [title] NVARCHAR(max) NOT NULL, [body] NVARCHAR(max) NOT NULL,
      [severity] NVARCHAR(max) NOT NULL DEFAULT N'info', [read] INT NOT NULL DEFAULT 0,
      [action] NVARCHAR(max) NULL, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    competition_favorites: `
      [league_id] INT NOT NULL PRIMARY KEY REFERENCES ${ref("leagues")}([id]),
      [events] NVARCHAR(max) NOT NULL, [since] NVARCHAR(max) NOT NULL, [last_phase] NVARCHAR(max) NOT NULL DEFAULT N''`,
    ledger: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [date] NVARCHAR(max) NOT NULL, [category] NVARCHAR(max) NOT NULL, [amount] FLOAT(53) NOT NULL,
      [description] NVARCHAR(max) NOT NULL`,
    history: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [season] INT NOT NULL, [entity_type] NVARCHAR(100) NOT NULL,
      [entity_id] INT NOT NULL, [date] NVARCHAR(10) NOT NULL, [data] NVARCHAR(max) NOT NULL`,
    discipline: `
      [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]), [scope] NVARCHAR(100) NOT NULL,
      [yellow_cards] INT NOT NULL DEFAULT 0, [suspension] INT NOT NULL DEFAULT 0, [season] INT NOT NULL,
      PRIMARY KEY([player_id], [scope])`,
    financial_periods: `
      [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [season] INT NOT NULL,
      [revenue] FLOAT(53) NOT NULL DEFAULT 0, [wages] FLOAT(53) NOT NULL DEFAULT 0,
      [operating] FLOAT(53) NOT NULL DEFAULT 0, [amortization] FLOAT(53) NOT NULL DEFAULT 0,
      [agent_fees] FLOAT(53) NOT NULL DEFAULT 0, [sale_profit] FLOAT(53) NOT NULL DEFAULT 0,
      [excluded_investment] FLOAT(53) NOT NULL DEFAULT 0, [equity] FLOAT(53) NOT NULL DEFAULT 0,
      [closed] INT NOT NULL DEFAULT 0, PRIMARY KEY([club_id], [season])`,
    player_assets: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]), [cost] FLOAT(53) NOT NULL,
      [acquired] NVARCHAR(max) NOT NULL, [expires] NVARCHAR(max) NOT NULL, [status] NVARCHAR(32) NOT NULL DEFAULT N'active'`,
    registration_records: `
      [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]), [country_id] INT NOT NULL REFERENCES ${ref("countries")}([id]),
      [status] NVARCHAR(max) NOT NULL, [date] NVARCHAR(max) NOT NULL, [data] NVARCHAR(max) NOT NULL,
      PRIMARY KEY([player_id], [country_id])`,
    minor_applications: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]),
      [source_country_id] INT NOT NULL REFERENCES ${ref("countries")}([id]),
      [destination_country_id] INT NOT NULL REFERENCES ${ref("countries")}([id]), [route] NVARCHAR(max) NOT NULL,
      [requested_date] NVARCHAR(max) NOT NULL, [due_date] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(max) NOT NULL DEFAULT N'pending', [reason] NVARCHAR(max) NOT NULL DEFAULT N'',
      [data] NVARCHAR(max) NOT NULL, UNIQUE([player_id], [club_id])`,
    player_season_stats: `
      [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]), [season] INT NOT NULL,
      [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [league_id] INT NOT NULL,
      [minutes] INT NOT NULL DEFAULT 0, [appearances] INT NOT NULL DEFAULT 0,
      [goals] INT NOT NULL DEFAULT 0, [assists] INT NOT NULL DEFAULT 0,
      PRIMARY KEY([player_id], [season], [club_id], [league_id])`,
    player_match_appearances: `
      [fixture_id] INT NOT NULL REFERENCES ${ref("fixtures")}([id]), [player_id] INT NOT NULL REFERENCES ${ref("players")}([id]),
      [club_id] INT NOT NULL REFERENCES ${ref("clubs")}([id]), [season] INT NOT NULL, [date] NVARCHAR(10) NOT NULL,
      [position] NVARCHAR(max) NOT NULL, [started] INT NOT NULL, [minutes] INT NOT NULL,
      [minute_on] INT NOT NULL DEFAULT 0, [minute_off] INT NULL, [rating] FLOAT(53) NOT NULL,
      [goals] INT NOT NULL, [assists] INT NOT NULL, [stats] NVARCHAR(max) NOT NULL,
      PRIMARY KEY([fixture_id], [player_id])`,
    promises: `
      [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY, [player_id] INT NULL REFERENCES ${ref("players")}([id]),
      [type] NVARCHAR(max) NOT NULL, [target] FLOAT(53) NOT NULL, [due_date] NVARCHAR(max) NOT NULL,
      [status] NVARCHAR(max) NOT NULL DEFAULT N'active', [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    training_plans: `
      [club_id] INT NOT NULL PRIMARY KEY REFERENCES ${ref("clubs")}([id]),
      [focus] NVARCHAR(max) NOT NULL DEFAULT N'Balanced', [intensity] INT NOT NULL DEFAULT 50,
      [youth_focus] NVARCHAR(max) NOT NULL DEFAULT N'Technical', [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
    set_pieces: `
      [club_id] INT NOT NULL PRIMARY KEY REFERENCES ${ref("clubs")}([id]),
      [routine] NVARCHAR(max) NOT NULL DEFAULT N'Near post', [target] NVARCHAR(max) NOT NULL DEFAULT N'Centre-back',
      [risk] INT NOT NULL DEFAULT 50, [data] NVARCHAR(max) NOT NULL DEFAULT N'{}'`,
  };
  const index = (
    name: string,
    table: string,
    keys: string,
    filter = "",
    unique = false,
  ) =>
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [object_id] = OBJECT_ID(${sqlLiteral(ref(table))}) AND [name] = ${sqlLiteral(name)})
      CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(name)} ON ${ref(table)} (${keys})${filter ? ` WHERE ${filter}` : ""};`;
  return [
    {
      version: 1,
      name: "World tables",
      statements: WORLD_TABLES.map(
        (table) =>
          `IF OBJECT_ID(${sqlLiteral(ref(table))}, N'U') IS NULL CREATE TABLE ${ref(table)} (${definitions[table]});`,
      ),
    },
    {
      version: 2,
      name: "Playing squad assignment",
      statements: [
        `IF COL_LENGTH(${sqlLiteral(ref("players"))}, N'squad_club_id') IS NULL
          ALTER TABLE ${ref("players")} ADD [squad_club_id] INT NULL REFERENCES ${ref("clubs")}([id]);`,
        `IF COL_LENGTH(${sqlLiteral(ref("players"))}, N'playing_club_id') IS NULL
          ALTER TABLE ${ref("players")} ADD [playing_club_id] AS COALESCE([squad_club_id], [club_id]) PERSISTED;`,
        `CREATE OR ALTER TRIGGER ${ref("clear_transferred_squad")} ON ${ref("players")} AFTER UPDATE AS
          BEGIN
            SET NOCOUNT ON;
            IF UPDATE([club_id])
              UPDATE player SET [squad_club_id] = NULL FROM ${ref("players")} AS player
                INNER JOIN inserted AS current_row ON current_row.[id] = player.[id]
                INNER JOIN deleted AS previous_row ON previous_row.[id] = player.[id]
              WHERE current_row.[club_id] <> previous_row.[club_id]
                OR (current_row.[club_id] IS NULL AND previous_row.[club_id] IS NOT NULL)
                OR (current_row.[club_id] IS NOT NULL AND previous_row.[club_id] IS NULL);
          END;`,
      ],
    },
    {
      version: 3,
      name: "World indexes and notification deduplication",
      statements: [
        `IF COL_LENGTH(${sqlLiteral(ref("news"))}, N'notification_key') IS NULL
          ALTER TABLE ${ref("news")} ADD [notification_key] AS
            CONVERT(NVARCHAR(450), JSON_VALUE([data], '$.notificationKey')) COLLATE Latin1_General_100_BIN2 PERSISTED;`,
        `IF COL_LENGTH(${sqlLiteral(ref("news"))}, N'notification_unkeyed_id') IS NULL
          ALTER TABLE ${ref("news")} ADD [notification_unkeyed_id] AS
            (CASE WHEN JSON_VALUE([data], '$.notificationKey') IS NULL THEN [id] ELSE 0 END) PERSISTED;`,
        index(
          "news_notification_key",
          "news",
          "[notification_key], [notification_unkeyed_id]",
          "",
          true,
        ),
        index("player_club", "players", "[club_id], [age_group], [ability]"),
        index(
          "player_market_squad",
          "players",
          "[club_id], [age_group], [position], [role], [wage]",
        ),
        index(
          "player_market_candidate",
          "players",
          "[id], [contract_end], [injury_until]",
          "[club_id] IS NOT NULL AND [parent_club_id] IS NULL AND [age] >= 18 AND [age] <= 31 AND [age_group] = N'Senior' AND [role] <> N'Retired'",
        ),
        index(
          "player_nationality",
          "players",
          "[country_id], [age], [ability]",
        ),
        index(
          "player_filter",
          "players",
          "[position], [age], [ability], [potential], [value]",
        ),
        index("player_name", "players", "[name]"),
        index(
          "player_shortlist",
          "players",
          "[shortlisted]",
          "[shortlisted] = 1",
        ),
        index(
          "player_playing_squad",
          "players",
          "[playing_club_id], [age_group], [ability]",
        ),
        index("fixture_date", "fixtures", "[status], [date]"),
        index("fixture_home", "fixtures", "[home_id], [date]"),
        index("fixture_away", "fixtures", "[away_id], [date]"),
        index("fixture_league", "fixtures", "[league_id], [season], [round]"),
        index("staff_club", "staff", "[club_id]"),
        index(
          "staff_director_assistant",
          "staff",
          "[club_id]",
          "[role] = N'Sporting director assistant' AND [club_id] IS NOT NULL",
          true,
        ),
        index(
          "board_affiliate_pending",
          "board_affiliate_requests",
          "[club_id]",
          "[status] = N'pending'",
          true,
        ),
        index(
          "unexpected_event_club",
          "unexpected_events",
          "[club_id], [status], [date] DESC",
        ),
        index("loan_player", "loans", "[player_id], [status]"),
        index(
          "transfer_payment_due",
          "transfer_payments",
          "[paid_date], [due_date]",
        ),
        index(
          "transfer_payment_club",
          "transfer_payments",
          "[payer_id], [payee_id], [paid_date]",
        ),
        index(
          "buy_back_player",
          "buy_back_clauses",
          "[player_id], [owner_id], [status]",
        ),
        index(
          "history_entity",
          "history",
          "[entity_type], [entity_id], [date]",
        ),
        index("assets_club", "player_assets", "[club_id], [status]"),
        index(
          "assets_player",
          "player_assets",
          "[player_id], [club_id], [status]",
        ),
        index(
          "appearances_player_season",
          "player_match_appearances",
          "[player_id], [season], [date] DESC, [fixture_id] DESC",
        ),
        index(
          "appearances_club",
          "player_match_appearances",
          "[club_id], [season]",
        ),
      ],
    },
    {
      version: 4,
      name: "Chunked SQL saves",
      statements: [
        `IF OBJECT_ID(${sqlLiteral(ref("save_slots"))}, N'U') IS NULL
          CREATE TABLE ${ref("save_slots")} (
            [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, [name] NVARCHAR(200) NOT NULL,
            [career_id] NVARCHAR(100) NULL, [career_metadata] NVARCHAR(max) NULL,
            [created_at] DATETIME2 NOT NULL, [automatic] BIT NOT NULL, [imported] BIT NOT NULL DEFAULT 0,
            [format_version] INT NOT NULL, [byte_length] BIGINT NOT NULL DEFAULT 0,
            [sha256] CHAR(64) NULL, [complete] BIT NOT NULL DEFAULT 0);`,
        `IF OBJECT_ID(${sqlLiteral(ref("save_chunks"))}, N'U') IS NULL
          CREATE TABLE ${ref("save_chunks")} (
            [save_id] UNIQUEIDENTIFIER NOT NULL REFERENCES ${ref("save_slots")}([id]) ON DELETE CASCADE,
            [ordinal] INT NOT NULL, [data] VARBINARY(max) NOT NULL, PRIMARY KEY([save_id], [ordinal]));`,
      ],
    },
    {
      version: 5,
      name: "Continuous rating precision",
      statements: Object.entries({
        countries: ["reputation"],
        leagues: ["reputation"],
        clubs: ["reputation", "facilities"],
        staff: ["ability", "tactical_knowledge"],
      }).flatMap(([table, columns]) =>
        columns.map(
          (column) =>
            `ALTER TABLE ${ref(table)} ALTER COLUMN ${quoteIdentifier(column)} FLOAT(53) NOT NULL;`,
        ),
      ),
    },
    {
      version: 6,
      name: "Restricted world identity reseeding",
      statements: [
        `CREATE OR ALTER PROCEDURE ${ref("reseed_world_identity")} @table sysname
          WITH EXECUTE AS OWNER
          AS
          BEGIN
            SET NOCOUNT ON;
            IF @table NOT IN (${[...IDENTITY_TABLES].map(sqlLiteral).join(", ")})
              THROW 51000, 'Unknown world identity table.', 1;
            DECLARE @target nvarchar(260) = ${sqlLiteral(`${quoteIdentifier(schema)}.`)} + QUOTENAME(@table);
            DECLARE @maximum int, @statement nvarchar(max);
            SET @statement = N'SELECT @maximum = MAX([id]) FROM ' + @target;
            EXEC sys.sp_executesql @statement, N'@maximum int OUTPUT', @maximum OUTPUT;
            IF @maximum IS NULL AND NOT EXISTS (
              SELECT 1 FROM sys.identity_columns WHERE [object_id] = OBJECT_ID(@target) AND [last_value] IS NOT NULL)
              RETURN;
            SET @statement = N'DBCC CHECKIDENT (' + QUOTENAME(@target, '''') + N', RESEED, '
              + CONVERT(nvarchar(20), COALESCE(@maximum, 0)) + N') WITH NO_INFOMSGS;';
            EXEC sys.sp_executesql @statement;
          END;`,
      ],
    },
  ];
}

export function appearanceBackfill(schema: string): string[] {
  const ref = (table: string) => tableName(schema, table);
  const statements: string[] = [];
  for (const side of ["home", "away"])
    for (const group of ["lineup", "bench"])
      statements.push(`
        ;WITH appearances AS (
          SELECT fixture.[id] AS [fixture_id], TRY_CONVERT(INT, JSON_VALUE(roster.[value], '$.id')) AS [player_id],
            fixture.[${side}_id] AS [club_id], fixture.[season], fixture.[date],
            JSON_VALUE(roster.[value], '$.position') AS [position], ${group === "lineup" ? 1 : 0} AS [started],
            TRY_CONVERT(INT, JSON_VALUE(performance.[value], '$.minutes')) AS [minutes],
            COALESCE(sub_on.[minute], 0) AS [minute_on], COALESCE(sub_off.[minute], exit_event.[minute]) AS [minute_off],
            COALESCE(TRY_CONVERT(FLOAT(53), JSON_VALUE(performance.[value], '$.rating')), 0) AS [rating],
            COALESCE(TRY_CONVERT(INT, JSON_VALUE(performance.[value], '$.goals')), 0) AS [goals],
            COALESCE(TRY_CONVERT(INT, JSON_VALUE(performance.[value], '$.assists')), 0) AS [assists],
            performance.[value] AS [stats],
            ROW_NUMBER() OVER (PARTITION BY fixture.[id], JSON_VALUE(roster.[value], '$.id')
              ORDER BY TRY_CONVERT(INT, roster.[key])) AS [occurrence]
          FROM ${ref("fixtures")} AS fixture
          CROSS APPLY OPENJSON(fixture.[data], '$.snapshot.${side}.${group}') AS roster
          CROSS APPLY OPENJSON(fixture.[data], '$.players') AS performance
          INNER JOIN ${ref("players")} AS player ON player.[id] = TRY_CONVERT(INT, JSON_VALUE(roster.[value], '$.id'))
          OUTER APPLY (SELECT TOP (1) TRY_CONVERT(INT, JSON_VALUE([value], '$.minute')) AS [minute]
            FROM OPENJSON(fixture.[data], '$.substitutions')
            WHERE TRY_CONVERT(INT, JSON_VALUE([value], '$.onId')) = player.[id] ORDER BY TRY_CONVERT(INT, [key])) AS sub_on
          OUTER APPLY (SELECT TOP (1) TRY_CONVERT(INT, JSON_VALUE([value], '$.minute')) AS [minute]
            FROM OPENJSON(fixture.[data], '$.substitutions')
            WHERE TRY_CONVERT(INT, JSON_VALUE([value], '$.offId')) = player.[id] ORDER BY TRY_CONVERT(INT, [key])) AS sub_off
          OUTER APPLY (SELECT TOP (1) TRY_CONVERT(INT, JSON_VALUE([value], '$.minute')) AS [minute]
            FROM OPENJSON(fixture.[data], '$.events')
            WHERE TRY_CONVERT(INT, JSON_VALUE([value], '$.playerId')) = player.[id]
              AND JSON_VALUE([value], '$.type') IN (N'red card', N'injury') ORDER BY TRY_CONVERT(INT, [key])) AS exit_event
          WHERE fixture.[status] = N'played' AND TRY_CONVERT(INT, performance.[key]) = player.[id]
            AND TRY_CONVERT(INT, JSON_VALUE(performance.[value], '$.minutes')) > 0
        )
        INSERT INTO ${ref("player_match_appearances")}
          ([fixture_id], [player_id], [club_id], [season], [date], [position], [started], [minutes],
           [minute_on], [minute_off], [rating], [goals], [assists], [stats])
        SELECT [fixture_id], [player_id], [club_id], [season], [date], [position], [started], [minutes],
          [minute_on], [minute_off], [rating], [goals], [assists], [stats]
        FROM appearances AS appearance WHERE [occurrence] = 1 AND NOT EXISTS (
          SELECT 1 FROM ${ref("player_match_appearances")} AS existing
          WHERE existing.[fixture_id] = appearance.[fixture_id] AND existing.[player_id] = appearance.[player_id]);`);
  return statements;
}
