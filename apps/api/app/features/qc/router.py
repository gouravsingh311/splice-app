"""PRD-04/05/14 FastAPI routes for QC evaluation, rules registry, and admin policy ops."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.core.logging import get_logger
from app.features.admin.qc_policy import AdminQcPolicyService
from app.features.qc.contracts import (
    GetActiveQcPolicyResponse,
    ListQcRulesResponse,
    QcEvaluationRequest,
    QcEvaluationResult,
    QcResultsResponse,
    UpdateActiveQcPolicyRequest,
    UpdateActiveQcPolicyResponse,
)
from app.features.qc.rules import QcRulesRegistryService
from app.features.qc.service import QcEngineService

router = APIRouter(tags=["qc"])
logger = get_logger(__name__)


def get_qc_engine(request: Request) -> QcEngineService:
    return request.app.state.qc_engine_service


def get_qc_registry(request: Request) -> QcRulesRegistryService:
    return request.app.state.qc_rules_registry_service


def get_admin_policy_service(request: Request) -> AdminQcPolicyService:
    return request.app.state.admin_qc_policy_service


@router.post("/qc/evaluate", response_model=QcEvaluationResult)
async def evaluate_qc(payload: QcEvaluationRequest, request: Request) -> QcEvaluationResult:
    logger.info("Evaluating QC.", extra={"submission_id": payload.submission_id})
    return get_qc_engine(request).evaluate(payload)


@router.get("/qc/results/{submission_id}", response_model=QcResultsResponse)
async def get_qc_results(submission_id: str, request: Request) -> QcResultsResponse:
    logger.info("Fetching QC results.", extra={"submission_id": submission_id})
    return get_qc_engine(request).get_results(submission_id)


@router.get("/qc/rules", response_model=ListQcRulesResponse)
async def list_qc_rules(
    request: Request,
    include_disabled: bool = Query(default=False),
    policy_id: str | None = Query(default=None),
) -> ListQcRulesResponse:
    logger.info(
        "Listing QC rules.",
        extra={"include_disabled": include_disabled, "policy_id": policy_id},
    )
    return get_qc_registry(request).list_rules(
        include_disabled=include_disabled,
        policy_id=policy_id,
    )


@router.get("/admin/qc/policies/active", response_model=GetActiveQcPolicyResponse)
async def get_active_qc_policy(request: Request) -> GetActiveQcPolicyResponse:
    return get_admin_policy_service(request).get_active_policy()


@router.put("/admin/qc/policies/active", response_model=UpdateActiveQcPolicyResponse)
async def update_active_qc_policy(
    payload: UpdateActiveQcPolicyRequest, request: Request
) -> UpdateActiveQcPolicyResponse:
    logger.info("Updating active QC policy.", extra={"policy_id": payload.policy.policy_id})
    return get_admin_policy_service(request).update_active_policy(payload)
