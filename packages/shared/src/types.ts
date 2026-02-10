export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
    role: Role;
    content: string;
}

export interface Env {
    OPENAI_API_KEY: string;
}