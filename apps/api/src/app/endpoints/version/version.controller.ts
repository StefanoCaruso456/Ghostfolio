import { Controller, Get, VERSION_NEUTRAL, Version } from '@nestjs/common';

@Controller('version')
export class VersionController {
  @Get()
  @Version(VERSION_NEUTRAL)
  public getVersion() {
    return {
      buildSha: process.env.BUILD_SHA ?? null,
      environment: process.env.NODE_ENV ?? 'unknown'
    };
  }
}
