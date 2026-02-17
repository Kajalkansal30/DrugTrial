from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from backend.agents.chat_agent import TrialChatAgent

router = APIRouter(prefix="/api/chat", tags=["chat"])

# Singleton agent
_chat_agent = None

def get_chat_agent():
    global _chat_agent
    if _chat_agent is None:
        _chat_agent = TrialChatAgent()
    return _chat_agent

class ChatRequest(BaseModel):
    query: str
    trial_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str

@router.post("/", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest, agent: TrialChatAgent = Depends(get_chat_agent)):
    """
    Chat with the specialized Trial Agent.
    """
    response = agent.chat(request.query, request.trial_id)
    return {"response": response}
