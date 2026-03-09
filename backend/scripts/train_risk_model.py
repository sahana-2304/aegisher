"""
CLI helper to train and persist the risk model artifact.
Usage:
  py -3.14 scripts/train_risk_model.py
"""
from __future__ import annotations

import os
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.risk_model_trainer import train_risk_model


def main():
    dataset_path = BACKEND_DIR / "data" / "tamil_nadu_women_safety_dataset.csv"
    model_path = Path(os.getenv("RISK_MODEL_PATH", BACKEND_DIR / "models" / "risk_model.pkl"))
    if not model_path.is_absolute():
        model_path = BACKEND_DIR / model_path

    result = train_risk_model(dataset_path, model_path)
    print("Training complete")
    print(f"Model: {result['model_path']}")
    print(f"Samples used: {result['samples_used']}")
    print(f"Metrics: {result['metrics']}")


if __name__ == "__main__":
    main()
