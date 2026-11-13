import os
import sys
import tempfile
from pathlib import Path

# Point the app at a throwaway database before anything imports the engine.
_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["PRANAMAP_DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ["PRANAMAP_ESCALATION_INTERVAL_SECONDS"] = "3600"
os.environ["PRANAMAP_MEDIA_DIR"] = str(_tmp.parent / "media")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
