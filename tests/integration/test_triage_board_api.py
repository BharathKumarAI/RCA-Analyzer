"""Integration tests for Live Triage Board and Ticket Investigation Workspace API."""

from fastapi.testclient import TestClient
from app.api.application import create_app
from app.api.routes.triage import get_triage_store
from tests.triage_support import create_triage_case
from types import SimpleNamespace
from tests.support import connectors, model_factory, settings_for


def test_live_triage_board_api_flow(tmp_path):
    settings, token = settings_for(tmp_path, mode="live")
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token("admin")

        # Reads must not manufacture tickets in an empty project.
        empty = client.get("/api/v1/triage/live-board", headers=headers)
        assert empty.status_code == 200
        assert empty.json()["focus_queue"] == []
        assert empty.json()["total_tickets"] == 0
        missing = client.get("/api/v1/triage/tickets/RS-177053", headers=headers)
        assert missing.status_code == 404
        assert client.get("/api/v1/triage/live-board", headers=headers).json()["total_tickets"] == 0
        store = client.portal.call(get_triage_store, SimpleNamespace(app=client.app))
        client.portal.call(create_triage_case, store.engine, settings.tenant_id, settings.project_id)

        # 1. Get Live Board
        res = client.get("/api/v1/triage/live-board", headers=headers)
        assert res.status_code == 200, res.text
        board = res.json()
        assert "urgency_strip" in board
        assert "work_buckets" in board
        assert "focus_queue" in board
        assert "team_capacity" in board
        assert "connectors_health" in board
        assert len(board["focus_queue"]) > 0

        # Check deterministic focus queue ordering
        p1_tickets = [item for item in board["focus_queue"] if item["ticket"]["priority"] == "P1"]
        assert len(p1_tickets) > 0
        first_ticket = board["focus_queue"][0]["ticket"]
        ticket_id = first_ticket["ticket_id"]

        # 2. Get Ticket Workspace
        res_ws = client.get(f"/api/v1/triage/tickets/{ticket_id}", headers=headers)
        assert res_ws.status_code == 200, res_ws.text
        ws = res_ws.json()
        assert ws["ticket"]["ticket_id"] == ticket_id
        assert "sla" in ws
        assert len(ws["queue_stays"]) >= 1
        assert "tool_proposals" in ws
        assert len(ws["tool_proposals"]) >= 1
        assert "related_tickets" in ws

        # 3. Acknowledge Ticket
        res_ack = client.post(f"/api/v1/triage/tickets/{ticket_id}/acknowledge", headers=headers)
        assert res_ack.status_code == 200, res_ack.text
        assert res_ack.json()["status"] == "ok"

        # 4. Edit Tool Proposal Query
        prop = ws["tool_proposals"][0]
        prop_id = prop["proposal_id"]
        res_rev = client.post(
            f"/api/v1/triage/tool-proposals/{prop_id}/revision",
            headers=headers,
            json={"current_query": "index=billing error | stats count", "parameters": {"limit": 50}},
        )
        assert res_rev.status_code == 200, res_rev.text
        assert res_rev.json()["current_query"] == "index=billing error | stats count"

        # 5. Execute Tool Proposal
        res_exec = client.post(
            f"/api/v1/triage/tool-proposals/{prop_id}/execute",
            headers=headers,
            json={},
        )
        assert res_exec.status_code == 200, res_exec.text
        assert res_exec.json()["status"] == "ok"
        assert "result" in res_exec.json()

        # 6. Promote Result to Evidence
        res_promo = client.post(
            f"/api/v1/triage/tool-proposals/{prop_id}/promote-evidence",
            headers=headers,
            json={"summary": "Promoted test evidence", "confidence": 0.95},
        )
        assert res_promo.status_code == 200, res_promo.text
        ev_id = res_promo.json()["evidence_id"]

        # 7. Update Evidence Status
        res_ev = client.post(
            f"/api/v1/triage/evidence/{ev_id}/status",
            headers=headers,
            json={"status": "REJECTED"},
        )
        assert res_ev.status_code == 200, res_ev.text
        assert res_ev.json()["new_status"] == "REJECTED"

        # 8. Approve Governed Action
        if ws["governed_actions"]:
            act_id = ws["governed_actions"][0]["action_id"]
            res_act = client.post(f"/api/v1/triage/actions/{act_id}/approve", headers=headers)
            assert res_act.status_code == 200, res_act.text
            assert res_act.json()["status"] == "ok"

        # 9. Escalate Ticket
        res_esc = client.post(
            f"/api/v1/triage/tickets/{ticket_id}/escalate",
            headers=headers,
            json={"target_team": "Core NetOps", "reason": "Testing escalation handoff"},
        )
        assert res_esc.status_code == 200, res_esc.text
        assert res_esc.json()["work_state"] == "APP_TEAM"

        # 10. Return Ticket
        res_ret = client.post(
            f"/api/v1/triage/tickets/{ticket_id}/return",
            headers=headers,
            json={"from_team": "Core NetOps", "reason": "Testing return to triage"},
        )
        assert res_ret.status_code == 200, res_ret.text
        assert res_ret.json()["work_state"] == "RETURNED"

        # 11. Verify Live Board reflects updated return state
        res_updated = client.get("/api/v1/triage/live-board?work_state=RETURNED", headers=headers)
        assert res_updated.status_code == 200
        returned_keys = [item["ticket"]["ticket_id"] for item in res_updated.json()["focus_queue"]]
        assert ticket_id in returned_keys

        # 12. Fast Stage Update
        res_stage = client.patch(
            f"/api/v1/triage/tickets/{ticket_id}/stage",
            headers=headers,
            json={"work_state": "IN_TRIAGE", "assigned_team": "Payments Core Team"},
        )
        assert res_stage.status_code == 200, res_stage.text
        assert res_stage.json()["work_state"] == "IN_TRIAGE"
        assert res_stage.json()["current_team"] == "Payments Core Team"

        # 13. Comments Thread (Add & List)
        res_comment = client.post(
            f"/api/v1/triage/tickets/{ticket_id}/comments",
            headers=headers,
            json={"comment": "Investigating connection pool leak on db-primary-01.", "is_internal": True},
        )
        assert res_comment.status_code == 200, res_comment.text
        assert res_comment.json()["comment"] == "Investigating connection pool leak on db-primary-01."

        res_comments = client.get(f"/api/v1/triage/tickets/{ticket_id}/comments", headers=headers)
        assert res_comments.status_code == 200, res_comments.text
        assert len(res_comments.json()) >= 1
        assert any("connection pool leak" in c["comment"] for c in res_comments.json())

        # 14. Calibration Feedback (Post & List)
        res_fb = client.post(
            "/api/v1/triage/feedback",
            headers=headers,
            json={
                "ticket_key": ticket_id,
                "rating": "UP",
                "tags": ["Query Precision", "Root Cause Depth"],
                "comment": "Accurately pinpointed HikariCP deadlock under 2 minutes.",
            },
        )
        assert res_fb.status_code == 200, res_fb.text
        assert res_fb.json()["rating"] == "UP"

        res_fb_list = client.get("/api/v1/triage/feedback", headers=headers)
        assert res_fb_list.status_code == 200, res_fb_list.text
        assert len(res_fb_list.json()) >= 1
        assert res_fb_list.json()[0]["ticketKey"] == ticket_id

        # 15. Ticket RCA Multi-Methodology Data
        res_rca = client.get(f"/api/v1/triage/tickets/{ticket_id}/rca", headers=headers)
        assert res_rca.status_code == 200, res_rca.text
        rca_data = res_rca.json()
        assert "five_whys" in rca_data
        assert "fishbone" in rca_data
        assert "kepner_tregoe" in rca_data
        assert "fmea" in rca_data
        assert "fault_tree" in rca_data
        assert "auto_ensemble" in rca_data

