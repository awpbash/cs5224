from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    class Config:
        alias_generator = to_camel
        populate_by_name = True


class Project(CamelModel):
    id: str
    user_id: str
    name: str
    task_type: str
    status: str = "created"
    data_source: Optional[str] = None
    dataset_s3_path: Optional[str] = None
    data_profile: Optional[dict] = None
    class_labels: Optional[list[str]] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class Job(CamelModel):
    job_id: str
    project_id: str
    user_id: str
    step_function_arn: Optional[str] = None
    model_type: Optional[str] = None
    hyperparameters: Optional[dict] = None
    status: str = "STARTING"
    current_step: Optional[str] = None
    metrics: Optional[dict] = None
    feature_importance: Optional[dict] = None
    model_artifact_s3_path: Optional[str] = None
    metrics_s3_path: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: Optional[str] = None
    error: Optional[dict] = None


class ColumnProfile(CamelModel):
    name: str
    dtype: str
    null_count: int
    unique_count: int
    mean: Optional[float] = None
    std: Optional[float] = None


class DataProfile(CamelModel):
    row_count: int
    column_count: int
    columns: list[ColumnProfile]
    preview: list[dict]
