-- Only tasks deliberately shared by an authenticated doctor enter this board.
-- No provider grants, mail, CVs, files or patient records are copied here.
CREATE TABLE IF NOT EXISTS team_board_tasks (
 id TEXT PRIMARY KEY,
 creator_id TEXT NOT NULL,
 creator_profile TEXT NOT NULL CHECK(creator_profile IN ('amir','arash')),
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 assignee TEXT NOT NULL CHECK(assignee IN ('amir','arash','both')),
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
 due_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS team_board_status_due ON team_board_tasks(status,due_at,created_at);
