"""
AegisHer — XGBoost Risk Model Training Pipeline

Features:
  latitude, longitude, hour_of_day, lighting_score, crowd_density,
  crime_density, distance_to_police_km, cctv_presence, past_incident_count

Label:
  risk_label (0=safe, 1=risky)
"""

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import xgboost as xgb
import shap
import joblib
import json

FEATURE_COLS = [
    "latitude", "longitude", "hour_of_day", "lighting_score",
    "crowd_density", "crime_density", "distance_to_police_km",
    "cctv_presence", "past_incident_count",
]
LABEL_COL = "risk_label"
MODEL_OUTPUT = "models/risk_model.json"
SHAP_OUTPUT = "models/shap_summary.json"


def generate_synthetic_data(n: int = 5000) -> pd.DataFrame:
    """
    Generate synthetic training data.
    Production: replace with real crime/incident dataset.
    """
    np.random.seed(42)
    df = pd.DataFrame({
        "latitude": np.random.uniform(12.9, 13.2, n),
        "longitude": np.random.uniform(80.1, 80.3, n),
        "hour_of_day": np.random.randint(0, 24, n),
        "lighting_score": np.random.beta(2, 2, n),
        "crowd_density": np.random.beta(2, 2, n),
        "crime_density": np.random.beta(1.5, 3, n),
        "distance_to_police_km": np.random.exponential(2.0, n),
        "cctv_presence": np.random.binomial(1, 0.6, n).astype(float),
        "past_incident_count": np.random.poisson(2, n).astype(float),
    })

    # Label: risky if crime_density high OR night + low lighting
    night_mask = (df["hour_of_day"] < 6) | (df["hour_of_day"] > 21)
    risk_score = (
        0.35 * df["crime_density"] +
        0.20 * (1 - df["lighting_score"]) * night_mask.astype(float) +
        0.15 * (1 - df["crowd_density"]) +
        0.15 * np.clip(df["distance_to_police_km"] / 5, 0, 1) +
        0.10 * (1 - df["cctv_presence"]) +
        0.05 * np.clip(df["past_incident_count"] / 10, 0, 1)
    )
    df[LABEL_COL] = (risk_score > 0.35).astype(int)
    print(f"[Data] Generated {n} samples. Risk ratio: {df[LABEL_COL].mean():.2%}")
    return df


def train(data_path: str = None) -> xgb.XGBClassifier:
    # Load or generate data
    if data_path:
        df = pd.read_csv(data_path)
        print(f"[Data] Loaded {len(df)} rows from {data_path}")
    else:
        print("[Data] No dataset provided. Using synthetic data.")
        df = generate_synthetic_data(n=10000)

    X = df[FEATURE_COLS]
    y = df[LABEL_COL]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    # Model
    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=(y == 0).sum() / (y == 1).sum(),
        use_label_encoder=False,
        eval_metric="auc",
        random_state=42,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=50, early_stopping_rounds=20)

    # Evaluation
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    print("\n[Metrics]", classification_report(y_test, y_pred, target_names=["Safe", "Risky"]))
    print(f"[AUC-ROC] {roc_auc_score(y_test, y_proba):.4f}")

    # SHAP explainability
    explainer = shap.TreeExplainer(model)
    shap_vals = explainer.shap_values(X_test[:100])
    mean_abs_shap = {col: float(abs(shap_vals[:, i]).mean()) for i, col in enumerate(FEATURE_COLS)}
    mean_abs_shap = dict(sorted(mean_abs_shap.items(), key=lambda x: -x[1]))
    print("\n[SHAP] Feature Importance:")
    for feat, importance in mean_abs_shap.items():
        print(f"  {feat:<30} {importance:.4f}")

    # Save
    import os
    os.makedirs("models", exist_ok=True)
    model.save_model(MODEL_OUTPUT)
    with open(SHAP_OUTPUT, "w") as f:
        json.dump(mean_abs_shap, f, indent=2)
    print(f"\n[Saved] Model → {MODEL_OUTPUT}")
    print(f"[Saved] SHAP  → {SHAP_OUTPUT}")

    return model


if __name__ == "__main__":
    import sys
    data_path = sys.argv[1] if len(sys.argv) > 1 else None
    train(data_path)