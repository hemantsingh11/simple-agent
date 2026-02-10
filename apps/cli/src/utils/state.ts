import { MessagesAnnotation } from "@langchain/langgraph";

export const AgentState = MessagesAnnotation;
export type AgentStateType = typeof AgentState.State;
