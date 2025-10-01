#!/usr/bin/env python3
"""
Script to create an initial admin user for the Query Generator Framework.
This script directly inserts a user into the database, bypassing API authentication.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime

import asyncpg
import bcrypt

def get_password_hash(password: str) -> str:
    # Ensure password is not longer than 72 bytes for bcrypt
    if len(password.encode('utf-8')) > 72:
        password = password[:72]
    # Use bcrypt directly to avoid passlib version issues
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

async def create_admin_user():
    """Create an initial admin user"""
    
    # Database connection parameters from environment variables
    DB_CONFIG = {
        'host': os.getenv('POSTGRES_HOST', 'postgres'),  # Docker service name
        'port': int(os.getenv('POSTGRES_PORT', '5432')),  # Internal container port
        'database': os.getenv('POSTGRES_DB', 'qg'),
        'user': os.getenv('POSTGRES_USER', 'qg'),
        'password': os.getenv('POSTGRES_PASSWORD', 'qg')
    }
    
    # Admin user details from environment variables
    admin_username = os.getenv('ADMIN_USERNAME', 'admin')
    admin_email = os.getenv('ADMIN_EMAIL', 'admin@example.com')
    admin_password = os.getenv('ADMIN_PASSWORD', 'admin123')
    admin_full_name = os.getenv('ADMIN_FULL_NAME', 'Administrator')
    
    print("🔧 Creating initial admin user...")
    
    try:
        # Connect to database
        conn = await asyncpg.connect(**DB_CONFIG)
        print("✅ Connected to database")
        
        # User details
        user_id = str(uuid.uuid4())
        
        # Hash password
        hashed_password = get_password_hash(admin_password)
        
        # Check if user already exists
        existing_user = await conn.fetchrow(
            "SELECT id FROM auth_users WHERE username = $1 OR email = $2",
            admin_username, admin_email
        )
        
        if existing_user:
            print("❌ Admin user already exists!")
            return
        
        # Insert user
        await conn.execute("""
            INSERT INTO auth_users (id, username, email, hashed_password, full_name, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """, user_id, admin_username, admin_email, hashed_password, admin_full_name, True, datetime.utcnow(), datetime.utcnow())
        
        # Assign admin role
        role_id = str(uuid.uuid4())
        await conn.execute("""
            INSERT INTO auth_user_roles (id, user_id, role_name, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5)
        """, role_id, user_id, "admin", datetime.utcnow(), datetime.utcnow())
        
        print("✅ Admin user created successfully!")
        print(f"   Username: {admin_username}")
        print(f"   Email: {admin_email}")
        print(f"   Password: {admin_password}")
        print("   Role: admin")
        print("")
        print("⚠️  IMPORTANT: Change the password after first login!")
        print(f"   You can now login at: http://{os.getenv('HOST', 'localhost')}:{os.getenv('BACKEND_PORT', '8000')}/docs")
        
    except Exception as e:
        print(f"❌ Error creating admin user: {e}")
        sys.exit(1)
    finally:
        if 'conn' in locals():
            await conn.close()

if __name__ == "__main__":
    asyncio.run(create_admin_user()) 