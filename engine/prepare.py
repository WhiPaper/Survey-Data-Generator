from __future__ import annotations

from pathlib import Path

import pandas as pd


def read_source(path: Path) -> pd.DataFrame:
    return pd.read_parquet(path)


def write_parquet(data: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data.to_parquet(path, index=False)


def smoke_source() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "response_id": ["smoke-1", "smoke-2"],
            "submitted_at": ["2026-09-01T00:00:00Z", "2026-09-01T00:01:00Z"],
            "score": [4, 5],
        }
    )
