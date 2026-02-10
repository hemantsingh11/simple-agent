import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { AgentStateType } from "./state.js";

export function createModelNode(tools: StructuredToolInterface[]) {
  const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 }).bindTools(
    tools
  );

  return async (state: AgentStateType) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };
}

export function createToolsNode(tools: StructuredToolInterface[]) {
  return new ToolNode(tools);
}

export { toolsCondition };
