# Database models. Importing here ensures SQLAlchemy registers every table
# in Base.metadata on app startup (used by create_db_and_tables and Alembic).
from app.models.sector import Sector  # noqa: F401
from app.models.auth import User, UserRole  # noqa: F401
from app.models.catalog import Catalog, CatalogObject  # noqa: F401
from app.models.history import QueryFeedback, QueryHistory  # noqa: F401
from app.models.knowledge import Example, Metric, Note  # noqa: F401
from app.models.policies import Policy  # noqa: F401
from app.models.settings import Setting  # noqa: F401
from app.models.vector import Embedding  # noqa: F401
from app.models.correction import Correction  # noqa: F401
from app.models.audit import AuditLog  # noqa: F401
