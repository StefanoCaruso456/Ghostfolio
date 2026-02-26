import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum AiFeedbackRatingDto {
  UP = 'UP',
  DOWN = 'DOWN'
}

export class AiFeedbackDto {
  @IsEnum(AiFeedbackRatingDto)
  rating: AiFeedbackRatingDto;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
