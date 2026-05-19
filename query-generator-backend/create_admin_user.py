#!/usr/bin/env python3
"""
Bootstrap the initial **General** account (root admin).

Runs once on first deploy via docker-compose. Idempotent: if the user
already exists, the script exits cleanly without re-hashing or
duplicating role rows.

The General role has `sector_id IS NULL` — Generals see every Sector by
design (see ROADMAP.md §1).
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime

import asyncpg
import bcrypt


def get_password_hash(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        encoded = encoded[:72]
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


async def create_general() -> None:
    db_config = {
        "host": os.getenv("POSTGRES_HOST", "postgres"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "database": os.getenv("POSTGRES_DB", "qg"),
        "user": os.getenv("POSTGRES_USER", "qg"),
        "password": os.getenv("POSTGRES_PASSWORD", "qg"),
    }

    username = os.getenv("ADMIN_USERNAME", "admin")
    email = os.getenv("ADMIN_EMAIL", "admin@example.com")
    password = os.getenv("ADMIN_PASSWORD", "admin123")
    full_name = os.getenv("ADMIN_FULL_NAME", "The General")

    print("🪖 Bootstrapping initial General account…")

    conn = None
    try:
        conn = await asyncpg.connect(**db_config)
        print("   ✅ Connected to database")

        existing = await conn.fetchrow(
            "SELECT id FROM auth_users WHERE username = $1 OR email = $2",
            username,
            email,
        )
        if existing:
            user_id = existing["id"]
            print(f"   ℹ User already exists ({user_id}); checking General role…")
        else:
            user_id = uuid.uuid4()
            now = datetime.utcnow()
            await conn.execute(
                """
                INSERT INTO auth_users
                    (id, username, email, hashed_password, full_name, is_active,
                     created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                user_id,
                username,
                email,
                get_password_hash(password),
                full_name,
                True,
                now,
                now,
            )
            print(f"   ✅ Created user ({user_id})")

        # Ensure they have an active General role (sector_id IS NULL).
        existing_role = await conn.fetchrow(
            """
            SELECT id FROM auth_user_roles
            WHERE user_id = $1 AND role_name = 'general' AND deleted_at IS NULL
            """,
            user_id,
        )
        if existing_role:
            print("   ℹ General role already active — nothing to do")
        else:
            now = datetime.utcnow()
            await conn.execute(
                """
                INSERT INTO auth_user_roles
                    (id, user_id, sector_id, role_name, created_at, updated_at)
                VALUES ($1, $2, NULL, 'general', $3, $3)
                """,
                uuid.uuid4(),
                user_id,
                now,
            )
            print("   ✅ Assigned General role")

        host = os.getenv("HOST", "localhost")
        port = os.getenv("BACKEND_PORT", "8000")
        print("")
        print("✅ Bootstrap complete.")
        print(f"   Username: {username}")
        print(f"   Email:    {email}")
        if not existing:
            print(f"   Password: {password}    (change after first login!)")
        print(f"   Login:    http://{host}:{port}/docs")

    except Exception as exc:
        print(f"❌ Error: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        if conn is not None:
            await conn.close()


if __name__ == "__main__":
    asyncio.run(create_general())
