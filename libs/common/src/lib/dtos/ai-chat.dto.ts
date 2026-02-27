import { IsArray, IsOptional, IsString } from 'class-validator';

export class AiChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsArray()
  history?: { content: string; role: 'assistant' | 'user' }[];

  @IsOptional()
  @IsArray()
  attachments?: {
    content: string;
    fileName: string;
    mimeType: string;
    size: number;
  }[];
}
