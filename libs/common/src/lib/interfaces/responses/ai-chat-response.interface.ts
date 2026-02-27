export interface AiChatMessage {
  content: string;
  role: 'assistant' | 'user';
  timestamp: string;
}

export interface AiChatResponse {
  conversationId: string;
  message: AiChatMessage;
  traceId?: string;
}
