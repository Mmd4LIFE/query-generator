"""phase1 sector overhaul

Introduces the Sector tenancy boundary and folds in every Phase-1 / Phase-3
schema fix from ROADMAP.md in a single revision:

 - new tables: dq_sectors, dq_corrections, dq_audit_log
 - Sector Zero seed row (fixed UUID, system-managed)
 - sector_id added (nullable -> backfilled -> NOT NULL) on every tenant-scoped table
 - auth_user_roles: role rename (admin→general, data_guy→captain, user→soldier)
                    + sector_id column + CHECK + partial unique index
 - dq_embeddings: drop qdrant_point_id + entity_id; add concrete FK columns
                  (object_id, note_id, metric_id, example_id, correction_id)
                  + CHECK exactly-one-FK, embed_model column
 - dq_feedback:   add FK cascade on history_id, sector_id, correction_status
 - dq_history:    + cost_status, correlation_id, context_chunk_ids, hot indexes
 - dq_policies:   correct partial unique index (catalog_id) WHERE deleted_at IS NULL
 - dq_settings:   add scope + sector_id; drop old unique on key

Revision ID: f2c1a7b8d901
Revises: b8e3a2c5d6f1
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "f2c1a7b8d901"
down_revision: Union[str, None] = "b8e3a2c5d6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Fixed sentinel — Sector Zero. Every pre-existing row gets parented to this
# so the migration is non-destructive: a single-tenant install before this
# revision becomes a single-Sector install after it.
SECTOR_ZERO_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    bind = op.get_bind()

    # ------------------------------------------------------------------
    # 1. dq_sectors
    # ------------------------------------------------------------------
    op.create_table(
        "dq_sectors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("code", name="uq_sectors_code"),
    )

    op.execute(
        sa.text(
            "INSERT INTO dq_sectors (id, code, name, description, is_active) "
            "VALUES (:id, 'sector_zero', 'Sector Zero', "
            "'Default sector — all pre-overhaul data lives here.', TRUE)"
        ).bindparams(id=SECTOR_ZERO_ID)
    )

    # ------------------------------------------------------------------
    # 2. dq_corrections
    # ------------------------------------------------------------------
    op.create_table(
        "dq_corrections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sector_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("catalog_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("history_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("correct_sql", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["sector_id"], ["dq_sectors.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["auth_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["auth_users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_corrections_sector", "dq_corrections", ["sector_id"])
    op.create_index("ix_corrections_history", "dq_corrections", ["history_id"])
    op.create_index("ix_corrections_catalog", "dq_corrections", ["catalog_id"])

    # ------------------------------------------------------------------
    # 3. dq_audit_log
    # ------------------------------------------------------------------
    op.create_table(
        "dq_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sector_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("target_type", sa.String(50), nullable=True),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("diff", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["sector_id"], ["dq_sectors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["auth_users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_audit_sector", "dq_audit_log", ["sector_id"])
    op.create_index("ix_audit_actor", "dq_audit_log", ["actor_id"])
    op.create_index("ix_audit_action", "dq_audit_log", ["action"])

    # ------------------------------------------------------------------
    # 4. Add sector_id to tenant-scoped tables (nullable → backfill → NOT NULL)
    # ------------------------------------------------------------------
    for table in [
        "dq_catalogs",
        "dq_objects",
        "dq_history",
        "dq_feedback",
        "dq_policies",
        "dq_notes",
        "dq_metrics",
        "dq_examples",
        "dq_embeddings",
    ]:
        op.add_column(
            table,
            sa.Column("sector_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.execute(
            sa.text(f"UPDATE {table} SET sector_id = :sid").bindparams(sid=SECTOR_ZERO_ID)
        )
        op.alter_column(table, "sector_id", nullable=False)
        op.create_foreign_key(
            f"fk_{table}_sector",
            table,
            "dq_sectors",
            ["sector_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index(f"ix_{table}_sector", table, ["sector_id"])

    # ------------------------------------------------------------------
    # 5. auth_user_roles: role rename + sector_id + check + partial unique
    # ------------------------------------------------------------------
    op.execute(
        "UPDATE auth_user_roles SET role_name = CASE role_name "
        "  WHEN 'admin' THEN 'general' "
        "  WHEN 'data_guy' THEN 'captain' "
        "  WHEN 'user' THEN 'soldier' "
        "  ELSE role_name END"
    )

    op.add_column(
        "auth_user_roles",
        sa.Column("sector_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # Non-general roles get parented to Sector Zero.
    op.execute(
        sa.text(
            "UPDATE auth_user_roles SET sector_id = :sid WHERE role_name <> 'general'"
        ).bindparams(sid=SECTOR_ZERO_ID)
    )
    op.create_foreign_key(
        "fk_user_roles_sector",
        "auth_user_roles",
        "dq_sectors",
        ["sector_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_user_roles_sector", "auth_user_roles", ["sector_id"])

    op.create_check_constraint(
        "ck_general_has_no_sector",
        "auth_user_roles",
        "(role_name = 'general' AND sector_id IS NULL) OR "
        "(role_name <> 'general' AND sector_id IS NOT NULL)",
    )

    # At most one active role per (user, sector). Generals: sector_id NULL.
    op.execute(
        "CREATE UNIQUE INDEX uq_user_active_role_per_sector "
        "ON auth_user_roles (user_id, sector_id) WHERE deleted_at IS NULL"
    )

    # Add FK from user_roles.user_id → auth_users.id (was missing ON DELETE).
    # The original migration created it without cascade — drop and recreate.
    try:
        op.drop_constraint("auth_user_roles_user_id_fkey", "auth_user_roles", type_="foreignkey")
    except Exception:
        pass
    op.create_foreign_key(
        "auth_user_roles_user_id_fkey",
        "auth_user_roles",
        "auth_users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # ------------------------------------------------------------------
    # 6. dq_embeddings: polymorphic refactor + drop qdrant_point_id
    # ------------------------------------------------------------------
    # New concrete FK columns (all nullable, one will be set per row).
    op.add_column("dq_embeddings", sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_embeddings", sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_embeddings", sa.Column("metric_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_embeddings", sa.Column("example_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_embeddings", sa.Column("correction_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_embeddings", sa.Column("embed_model", sa.String(100), nullable=True))

    # Backfill from (kind, entity_id) into the right column.
    op.execute("UPDATE dq_embeddings SET object_id  = entity_id WHERE kind = 'object'  AND entity_id IS NOT NULL")
    op.execute("UPDATE dq_embeddings SET note_id    = entity_id WHERE kind = 'note'    AND entity_id IS NOT NULL")
    op.execute("UPDATE dq_embeddings SET metric_id  = entity_id WHERE kind = 'metric'  AND entity_id IS NOT NULL")
    op.execute("UPDATE dq_embeddings SET example_id = entity_id WHERE kind = 'example' AND entity_id IS NOT NULL")
    # Existing rows: assume text-embedding-3-large (the previous default).
    op.execute(
        "UPDATE dq_embeddings SET embed_model = 'text-embedding-3-large' WHERE embed_model IS NULL"
    )

    # New FK constraints.
    op.create_foreign_key("fk_emb_object",     "dq_embeddings", "dq_objects",     ["object_id"],     ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_emb_note",       "dq_embeddings", "dq_notes",       ["note_id"],       ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_emb_metric",     "dq_embeddings", "dq_metrics",     ["metric_id"],     ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_emb_example",    "dq_embeddings", "dq_examples",    ["example_id"],    ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_emb_correction", "dq_embeddings", "dq_corrections", ["correction_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_emb_catalog",    "dq_embeddings", "dq_catalogs",    ["catalog_id"],    ["id"], ondelete="CASCADE")

    # Exactly-one-non-null check.
    op.create_check_constraint(
        "ck_embedding_exactly_one_fk",
        "dq_embeddings",
        "(CASE WHEN object_id     IS NOT NULL THEN 1 ELSE 0 END"
        " + CASE WHEN note_id       IS NOT NULL THEN 1 ELSE 0 END"
        " + CASE WHEN metric_id     IS NOT NULL THEN 1 ELSE 0 END"
        " + CASE WHEN example_id    IS NOT NULL THEN 1 ELSE 0 END"
        " + CASE WHEN correction_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
    )

    # Drop legacy columns.
    op.drop_index("ix_dq_embeddings_qdrant_point_id", table_name="dq_embeddings")
    op.drop_column("dq_embeddings", "qdrant_point_id")
    op.drop_index("ix_dq_embeddings_entity_id", table_name="dq_embeddings")
    op.drop_column("dq_embeddings", "entity_id")

    # Hot-path index for parallel per-kind retrieval.
    op.create_index("ix_emb_sector_kind", "dq_embeddings", ["sector_id", "kind"])

    # ------------------------------------------------------------------
    # 7. dq_history: cost_status, correlation_id, context_chunk_ids
    # ------------------------------------------------------------------
    op.add_column("dq_history", sa.Column("cost_status", sa.String(32), nullable=True))
    op.add_column("dq_history", sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_history", sa.Column("context_chunk_ids", sa.JSON(), nullable=True))

    # Hot read paths.
    op.create_index("ix_history_sector_user_time", "dq_history", ["sector_id", "user_id", "created_at"])
    op.create_index("ix_history_sector_time", "dq_history", ["sector_id", "created_at"])

    # FK on history.user_id / catalog_id (RESTRICT — we soft-delete those, never hard-delete).
    op.create_foreign_key("fk_history_user", "dq_history", "auth_users", ["user_id"], ["id"], ondelete="RESTRICT")
    op.create_foreign_key("fk_history_catalog", "dq_history", "dq_catalogs", ["catalog_id"], ["id"], ondelete="RESTRICT")

    # ------------------------------------------------------------------
    # 8. dq_feedback: FK CASCADE on history_id + sector_id + correction_status
    # ------------------------------------------------------------------
    op.add_column("dq_feedback", sa.Column("correction_status", sa.String(20), nullable=True))
    op.create_foreign_key(
        "fk_feedback_history", "dq_feedback", "dq_history", ["history_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_feedback_user", "dq_feedback", "auth_users", ["user_id"], ["id"], ondelete="RESTRICT"
    )

    # ------------------------------------------------------------------
    # 9. dq_policies: correct partial-unique replacement for the dropped index
    # ------------------------------------------------------------------
    op.execute(
        "CREATE UNIQUE INDEX uq_policies_active_per_catalog "
        "ON dq_policies (catalog_id) WHERE deleted_at IS NULL"
    )
    op.create_foreign_key(
        "fk_policies_catalog", "dq_policies", "dq_catalogs", ["catalog_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_policies_created_by", "dq_policies", "auth_users", ["created_by"], ["id"], ondelete="RESTRICT"
    )
    op.create_foreign_key(
        "fk_policies_deleted_by", "dq_policies", "auth_users", ["deleted_by"], ["id"], ondelete="RESTRICT"
    )

    # ------------------------------------------------------------------
    # 10. dq_objects: composite index for schema browser
    # ------------------------------------------------------------------
    op.create_index(
        "ix_objects_sector_schema_table",
        "dq_objects",
        ["sector_id", "schema_name", "table_name"],
    )
    op.create_foreign_key(
        "fk_objects_catalog", "dq_objects", "dq_catalogs", ["catalog_id"], ["id"], ondelete="CASCADE"
    )

    # ------------------------------------------------------------------
    # 11. dq_settings: split into global / sector scope
    # ------------------------------------------------------------------
    op.add_column("dq_settings", sa.Column("scope", sa.String(16), nullable=False, server_default="global"))
    op.add_column("dq_settings", sa.Column("sector_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_settings_sector", "dq_settings", "dq_sectors", ["sector_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_settings_updated_by", "dq_settings", "auth_users", ["updated_by"], ["id"], ondelete="RESTRICT"
    )
    # Old constraint was UNIQUE(key); now (key, scope, sector_id).
    try:
        op.drop_constraint("dq_settings_key_key", "dq_settings", type_="unique")
    except Exception:
        # Some installs may have it under a different name.
        op.execute("ALTER TABLE dq_settings DROP CONSTRAINT IF EXISTS dq_settings_key_key")
    op.create_unique_constraint(
        "uq_settings_key_scope_sector", "dq_settings", ["key", "scope", "sector_id"]
    )
    op.create_index("ix_settings_key_scope", "dq_settings", ["key", "scope"])

    # ------------------------------------------------------------------
    # 12. dq_catalogs: index for hot list query (per sector, active only)
    # ------------------------------------------------------------------
    op.execute(
        "CREATE INDEX ix_catalogs_sector_active ON dq_catalogs(sector_id) WHERE is_active"
    )


def downgrade() -> None:
    # The downgrade for this revision is intentionally lossy: dropping
    # sector_id columns means we lose multi-tenant data. Use at your own risk.

    op.execute("DROP INDEX IF EXISTS ix_catalogs_sector_active")
    op.drop_index("ix_settings_key_scope", table_name="dq_settings")
    op.drop_constraint("uq_settings_key_scope_sector", "dq_settings", type_="unique")
    op.drop_constraint("fk_settings_updated_by", "dq_settings", type_="foreignkey")
    op.drop_constraint("fk_settings_sector", "dq_settings", type_="foreignkey")
    op.drop_column("dq_settings", "sector_id")
    op.drop_column("dq_settings", "scope")
    op.create_unique_constraint("dq_settings_key_key", "dq_settings", ["key"])

    op.drop_constraint("fk_objects_catalog", "dq_objects", type_="foreignkey")
    op.drop_index("ix_objects_sector_schema_table", table_name="dq_objects")

    op.drop_constraint("fk_policies_deleted_by", "dq_policies", type_="foreignkey")
    op.drop_constraint("fk_policies_created_by", "dq_policies", type_="foreignkey")
    op.drop_constraint("fk_policies_catalog", "dq_policies", type_="foreignkey")
    op.execute("DROP INDEX IF EXISTS uq_policies_active_per_catalog")

    op.drop_constraint("fk_feedback_user", "dq_feedback", type_="foreignkey")
    op.drop_constraint("fk_feedback_history", "dq_feedback", type_="foreignkey")
    op.drop_column("dq_feedback", "correction_status")

    op.drop_constraint("fk_history_catalog", "dq_history", type_="foreignkey")
    op.drop_constraint("fk_history_user", "dq_history", type_="foreignkey")
    op.drop_index("ix_history_sector_time", table_name="dq_history")
    op.drop_index("ix_history_sector_user_time", table_name="dq_history")
    op.drop_column("dq_history", "context_chunk_ids")
    op.drop_column("dq_history", "correlation_id")
    op.drop_column("dq_history", "cost_status")

    op.drop_index("ix_emb_sector_kind", table_name="dq_embeddings")
    op.drop_constraint("ck_embedding_exactly_one_fk", "dq_embeddings", type_="check")
    op.drop_constraint("fk_emb_catalog", "dq_embeddings", type_="foreignkey")
    op.drop_constraint("fk_emb_correction", "dq_embeddings", type_="foreignkey")
    op.drop_constraint("fk_emb_example", "dq_embeddings", type_="foreignkey")
    op.drop_constraint("fk_emb_metric", "dq_embeddings", type_="foreignkey")
    op.drop_constraint("fk_emb_note", "dq_embeddings", type_="foreignkey")
    op.drop_constraint("fk_emb_object", "dq_embeddings", type_="foreignkey")
    op.add_column("dq_embeddings", sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("dq_embeddings", sa.Column("qdrant_point_id", sa.String(255), nullable=True))
    op.execute("UPDATE dq_embeddings SET entity_id = COALESCE(object_id, note_id, metric_id, example_id, correction_id)")
    op.create_index("ix_dq_embeddings_entity_id", "dq_embeddings", ["entity_id"])
    op.create_index("ix_dq_embeddings_qdrant_point_id", "dq_embeddings", ["qdrant_point_id"])
    op.drop_column("dq_embeddings", "embed_model")
    op.drop_column("dq_embeddings", "correction_id")
    op.drop_column("dq_embeddings", "example_id")
    op.drop_column("dq_embeddings", "metric_id")
    op.drop_column("dq_embeddings", "note_id")
    op.drop_column("dq_embeddings", "object_id")

    op.drop_constraint("auth_user_roles_user_id_fkey", "auth_user_roles", type_="foreignkey")
    op.create_foreign_key(
        "auth_user_roles_user_id_fkey",
        "auth_user_roles",
        "auth_users",
        ["user_id"],
        ["id"],
    )
    op.execute("DROP INDEX IF EXISTS uq_user_active_role_per_sector")
    op.drop_constraint("ck_general_has_no_sector", "auth_user_roles", type_="check")
    op.drop_index("ix_user_roles_sector", table_name="auth_user_roles")
    op.drop_constraint("fk_user_roles_sector", "auth_user_roles", type_="foreignkey")
    op.drop_column("auth_user_roles", "sector_id")
    op.execute(
        "UPDATE auth_user_roles SET role_name = CASE role_name "
        "  WHEN 'general' THEN 'admin' "
        "  WHEN 'captain' THEN 'data_guy' "
        "  WHEN 'soldier' THEN 'user' "
        "  ELSE role_name END"
    )

    for table in [
        "dq_embeddings",
        "dq_examples",
        "dq_metrics",
        "dq_notes",
        "dq_policies",
        "dq_feedback",
        "dq_history",
        "dq_objects",
        "dq_catalogs",
    ]:
        op.drop_index(f"ix_{table}_sector", table_name=table)
        op.drop_constraint(f"fk_{table}_sector", table, type_="foreignkey")
        op.drop_column(table, "sector_id")

    op.drop_index("ix_audit_action", table_name="dq_audit_log")
    op.drop_index("ix_audit_actor", table_name="dq_audit_log")
    op.drop_index("ix_audit_sector", table_name="dq_audit_log")
    op.drop_table("dq_audit_log")

    op.drop_index("ix_corrections_catalog", table_name="dq_corrections")
    op.drop_index("ix_corrections_history", table_name="dq_corrections")
    op.drop_index("ix_corrections_sector", table_name="dq_corrections")
    op.drop_table("dq_corrections")

    op.drop_table("dq_sectors")
