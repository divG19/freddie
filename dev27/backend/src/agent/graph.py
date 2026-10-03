"""Streaming chat graph for the company knowledge assistant."""

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph


async def call_model(state: MessagesState):
    """Answer using the selected model without claiming database access."""
    model = ChatOpenAI(model="gpt-6-luna", streaming=True)
    response = await model.ainvoke([
        SystemMessage(content=(
            "You are a company knowledge assistant. Help users plan source-backed "
            "Open Knowledge Format (OKF) bundles. OKF represents knowledge as "
            "linked Markdown documents with YAML frontmatter. No company database "
            "connectors are configured yet. Never claim to have queried a database "
            "or generated a downloadable file. Ask for clarification when needed."
        )),
        *state["messages"],
    ])
    return {"messages": [response]}


graph = (
    StateGraph(MessagesState)
    .add_node("call_model", call_model)
    .add_edge(START, "call_model")
    .add_edge("call_model", END)
    .compile(name="Company Knowledge Assistant")
)
