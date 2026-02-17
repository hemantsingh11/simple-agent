import { SystemMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { AgentStateType } from "./state.js";

const TOOL_POLICY = [
  "Use search_web for any question that needs fresh internet data.",
  "search_web only fetches and returns a result_id; it never saves.",
  "After showing the result, ask the user if they want to save it.",
  "Only call save_to_db when user clearly confirms saving.",
  "Use get_from_db for topic-based retrieval.",
  "Use get_all_from_db when user asks to fetch everything in DB.",
  "Use get_by_id when user asks for a specific saved id.",
  "Never claim DB save/read success without using the corresponding DB tool.",
].join("\n");

export function createModelNode(tools: StructuredToolInterface[]) {
  const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 }).bindTools(
    tools
  );

  return async (state: AgentStateType) => {
    const response = await model.invoke([new SystemMessage(TOOL_POLICY), ...state.messages]);
    return { messages: [response] };
  };
}

export function createToolsNode(tools: StructuredToolInterface[]) {
  return new ToolNode(tools);
}

export { toolsCondition };
