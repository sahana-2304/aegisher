"""
Risk model training utilities.
Trains a binary classifier from the Tamil Nadu safety dataset and saves an artifact.
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split


FEATURE_COLUMNS = [
    "latitude",
    "longitude",
    "hour",
    "day_type_flag",
    "lighting_score",
    "crowd_density",
    "crime_density",
    "police_distance_km",
    "cctv_presence",
    "past_incident_count",
]
TARGET_COLUMN = "risk_zone"


def _prepare_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    required_columns = {
        "latitude",
        "longitude",
        "hour",
        "day_type",
        "lighting_score",
        "crowd_density",
        "crime_density_norm",
        "police_distance_km",
        "cctv_presence",
        "past_incident_count",
        TARGET_COLUMN,
    }
    missing = sorted(required_columns - set(df.columns))
    if missing:
        raise ValueError(f"Dataset is missing columns: {', '.join(missing)}")

    prepared = df.copy()
    prepared["day_type_flag"] = (prepared["day_type"].astype(str).str.lower() == "weekend").astype(int)
    prepared["crime_density"] = pd.to_numeric(prepared["crime_density_norm"], errors="coerce").fillna(0.0)
    # Normalize to 0-1 if dataset stores percentages.
    if prepared["crime_density"].max() > 1.0:
        prepared["crime_density"] = prepared["crime_density"] / 100.0

    for col in FEATURE_COLUMNS:
        prepared[col] = pd.to_numeric(prepared[col], errors="coerce")

    prepared[TARGET_COLUMN] = pd.to_numeric(prepared[TARGET_COLUMN], errors="coerce")
    prepared = prepared.dropna(subset=FEATURE_COLUMNS + [TARGET_COLUMN]).copy()
    prepared[TARGET_COLUMN] = prepared[TARGET_COLUMN].astype(int)

    return prepared


def train_risk_model(dataset_path: str | Path, model_output_path: str | Path) -> dict[str, Any]:
    dataset_path = Path(dataset_path)
    model_output_path = Path(model_output_path)

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    df = pd.read_csv(dataset_path)
    prepared = _prepare_dataframe(df)
    if prepared.empty:
        raise ValueError("Dataset produced no valid rows after preprocessing.")

    X = prepared[FEATURE_COLUMNS]
    y = prepared[TARGET_COLUMN]

    sample_size = int(os.getenv("RISK_TRAIN_SAMPLE_SIZE", "0") or "0")
    if sample_size > 0 and len(prepared) > sample_size:
        sampled = prepared.sample(n=sample_size, random_state=42).reset_index(drop=True)
        X = sampled[FEATURE_COLUMNS]
        y = sampled[TARGET_COLUMN]

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y,
    )

    model = HistGradientBoostingClassifier(
        learning_rate=0.08,
        max_iter=260,
        max_depth=8,
        min_samples_leaf=20,
        random_state=42,
    )
    model.fit(X_train, y_train)

    probs = model.predict_proba(X_test)[:, 1]
    preds = (probs >= 0.5).astype(int)

    metrics = {
        "accuracy": round(float(accuracy_score(y_test, preds)), 4),
        "precision": round(float(precision_score(y_test, preds, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, preds, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, preds, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, probs)), 4),
    }

    medians = X_train.median(numeric_only=True).to_dict()
    artifact = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "feature_medians": medians,
        "target_column": TARGET_COLUMN,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_path": str(dataset_path),
        "samples_used": int(len(X)),
    }

    model_output_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, model_output_path)

    return {
        "status": "ok",
        "model_path": str(model_output_path),
        "dataset_path": str(dataset_path),
        "samples_used": int(len(X)),
        "class_balance": {
            "class_0": int(np.sum(y == 0)),
            "class_1": int(np.sum(y == 1)),
        },
        "metrics": metrics,
        "feature_columns": FEATURE_COLUMNS,
    }
