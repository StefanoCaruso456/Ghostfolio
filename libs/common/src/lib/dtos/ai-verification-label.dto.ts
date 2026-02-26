import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AiVerificationLabelDto {
  @IsString()
  traceId: string;

  @IsBoolean()
  isHallucination: boolean;

  @IsBoolean()
  verificationShouldHavePassed: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
