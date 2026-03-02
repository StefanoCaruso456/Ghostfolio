import { IsOptional, IsString } from 'class-validator';

export class ExchangePlaidTokenDto {
  @IsString()
  publicToken: string;

  @IsString()
  institutionId: string;

  @IsString()
  institutionName: string;

  @IsOptional()
  @IsString()
  accountId?: string;
}
