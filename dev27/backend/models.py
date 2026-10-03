from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Cell = str | int | float | bool | None


class ParticipantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=32)
    team: str = Field(min_length=1, max_length=32)


class Participant(ParticipantRequest):
    author: str


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    clientMessageId: str = Field(min_length=1, max_length=128)
    author: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=4000)


class Message(BaseModel):
    id: str
    author: str
    role: Literal["user", "assistant"]
    text: str
    createdAt: str
    resultId: str | None = None


class Column(BaseModel):
    key: str
    label: str


class Result(BaseModel):
    id: str
    kind: Literal["churned", "metrics", "comparison", "query"]
    title: str
    columns: list[Column]
    rows: list[dict[str, Cell]]
    downloadUrl: str
    presentation: Literal["text", "table", "bar", "line"] = "table"
    chartMetric: str | None = None
    summary: str = ""
    truncated: bool = False


class Clarification(BaseModel):
    author: str
    text: str


class HistoryEntry(BaseModel):
    id: str
    author: str
    question: str
    clarifications: list[Clarification] = Field(default_factory=list)
    createdAt: str
    status: Literal["awaiting_period", "awaiting_clarification", "completed", "unsupported", "failed"]
    filters: dict[str, Cell] = Field(default_factory=dict)
    queryId: str | None = None
    sql: str | None = None
    parameters: dict[str, Cell] = Field(default_factory=dict)
    rowCount: int | None = None
    resultId: str | None = None
    executions: list[dict] = Field(default_factory=list)


class RoomState(BaseModel):
    roomId: Literal["demo"] = "demo"
    revision: int = 0
    busy: bool = False
    period: str | None = None
    customerIds: list[str] = Field(default_factory=list)
    messages: list[Message] = Field(default_factory=list)
    results: list[Result] = Field(default_factory=list)
    history: list[HistoryEntry] = Field(default_factory=list)
