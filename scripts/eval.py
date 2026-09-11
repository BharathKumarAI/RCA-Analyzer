"""Offline contract evaluation with native MLflow; no model-quality claims."""

import json
import os
import tempfile
from pathlib import Path

# Evaluation artifacts stay local even if deployment has a remote tracking URI.
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
import mlflow
from mlflow.genai.scorers import scorer
from fastapi.testclient import TestClient
from app.fast_api_app import create_app
from tests.support import FixtureModel, connectors, model_factory, settings_for


@scorer
def contract_status(outputs, expectations):
    return outputs["status"] == expectations["status"]


@scorer
def cited_evidence_exists(outputs):
    cited = [
        eid
        for finding in (outputs.get("result") or {}).get("findings", [])
        for eid in finding["evidence_ids"]
    ]
    return all(eid in outputs["evidence_ids"] for eid in cited)


@scorer
def secrets_absent(outputs):
    encoded = json.dumps(outputs)
    return not any(
        value in encoded
        for value in ("secret-value", "person@example.com", "SECRET-TOKEN")
    )


def main():
    artifact_dir = Path("data/evaluation").resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    mlflow.set_tracking_uri("sqlite:///" + str(artifact_dir / "mlflow.db"))
    mlflow.set_experiment("rca-offline-contracts")
    rows = []
    for case, expected in [
        ("valid", "SUCCEEDED"),
        ("invalid_citation", "FAILED"),
        ("missing_connectors", "BLOCKED"),
        ("demo", "SIMULATED"),
    ]:
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(
                directory, mode="demo" if case == "demo" else "live"
            )

            def factory(stage, config):
                return (
                    FixtureModel(model=config.model, stage=stage, invalid_citation=True)
                    if case == "invalid_citation"
                    else model_factory(stage, config)
                )

            with TestClient(
                create_app(
                    settings,
                    connectors={} if case == "missing_connectors" else connectors(),
                    model_factory=factory,
                )
            ) as client:
                response = client.post(
                    "/api/v1/runs",
                    headers=token(),
                    json={"prompt": "Investigate timeout", "incident_id": "SAMSON-101"},
                )
                response.raise_for_status()
                output = response.json()
                evidence = client.get(
                    f"/api/v1/runs/{output['run_id']}/evidence", headers=token()
                ).json()
                output["evidence_ids"] = [item["evidence_id"] for item in evidence]
                output["evidence"] = evidence
                rows.append(
                    {
                        "inputs": {"case": case},
                        "outputs": output,
                        "expectations": {"status": expected},
                    }
                )
    result = mlflow.genai.evaluate(
        data=rows, scorers=[contract_status, cited_evidence_exists, secrets_absent]
    )
    summary = {
        "scope": "Offline deterministic contract checks; not live RCA quality",
        "run_id": result.run_id,
        "metrics": result.metrics,
    }
    path = artifact_dir / "summary.json"
    path.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    if any(
        result.metrics.get(name + "/mean") != 1.0
        for name in ("contract_status", "cited_evidence_exists", "secrets_absent")
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
