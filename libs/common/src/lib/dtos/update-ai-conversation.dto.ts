import { IsString } from 'class-validator';

export class UpdateAiConversationDto {
  @IsString()
  title: string;
}
